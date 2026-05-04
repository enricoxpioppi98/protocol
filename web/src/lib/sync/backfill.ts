import { logAudit } from '@/lib/audit/broker';
import { getAdminClient } from '@/lib/supabase/admin';
import { runSync, type SyncResult } from './orchestrator';
import { SOURCE_POLICY, type SyncSource } from './policy';

/**
 * Auto-backfill: detect per-source gaps in the user's last 7 days of
 * biometrics_daily and silently fill them via the orchestrator.
 *
 * The "wow moment" is on dashboard mount: the trigger component POSTs to
 * `/api/sync/auto-backfill` once per page load, this module figures out which
 * sources have gaps, and runs `runSync` for those sources only. The
 * orchestrator's per-source cooldown (Garmin 1h, Whoop 15min) protects the
 * upstream services from thrash if the gate below is somehow bypassed.
 *
 * A separate auto-backfill cooldown lives here (not in policy.ts) — its job
 * is "don't fire this on every dashboard load," whereas policy.ts is "don't
 * hammer Garmin/Whoop." Different concerns, different gates.
 */

/** Auto-backfill cooldown — 30 minutes between successive auto-backfill runs. */
export const AUTO_BACKFILL_COOLDOWN_MS = 30 * 60 * 1000;

/** Default backfill window. */
export const AUTO_BACKFILL_DAYS = 7;

/** Apple Watch is push-only; we never pull, so we don't auto-backfill it. */
const PULLABLE_SOURCES: readonly SyncSource[] = (
  Object.keys(SOURCE_POLICY) as SyncSource[]
).filter((s) => SOURCE_POLICY[s].minIntervalMs > 0);

export type GapMap = Map<SyncSource, string[]>;

/**
 * Build the list of expected ISO `YYYY-MM-DD` dates for the last N days.
 *
 * We use UTC for v2 simplicity — server-side TZ math gets gnarly across DST
 * and we don't yet ship a per-user timezone field. The tradeoff: a user in
 * UTC-7 syncing at 11pm local on day D may see "filled day D" the next
 * morning even though their watch's day rolled over hours ago. Acceptable for
 * v2. v3: thread `users.timezone` through here.
 */
export function expectedDates(days: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Pure: given the per-source rows the user already has, return the missing
 * ISO dates per source over the last `days` window. Apple Watch (and any
 * future push-only sources) are excluded from the result regardless of input.
 *
 * - Source not present in `rows` at all → returns all `days` expected dates.
 * - Source has 5/7 dates → returns the 2 missing ones.
 * - Source has all dates → omitted from the map.
 */
export function detectGaps(
  rows: Array<{ date: string; source: string }>,
  sources: SyncSource[],
  days: number = AUTO_BACKFILL_DAYS,
  now: Date = new Date()
): GapMap {
  const expected = expectedDates(days, now);
  const expectedSet = new Set(expected);

  // Bucket existing rows by source → set of dates we already have.
  const haveBySource = new Map<SyncSource, Set<string>>();
  for (const row of rows) {
    if (!isSyncSource(row.source)) continue;
    const date = row.date.slice(0, 10);
    if (!expectedSet.has(date)) continue; // out of window — ignore
    let bucket = haveBySource.get(row.source);
    if (!bucket) {
      bucket = new Set<string>();
      haveBySource.set(row.source, bucket);
    }
    bucket.add(date);
  }

  const out: GapMap = new Map();
  for (const source of sources) {
    // Skip push-only sources — caller doesn't have to remember to filter.
    if (SOURCE_POLICY[source].minIntervalMs <= 0) continue;
    const have = haveBySource.get(source) ?? new Set<string>();
    const missing = expected.filter((d) => !have.has(d));
    if (missing.length > 0) {
      out.set(source, missing);
    }
  }
  return out;
}

function isSyncSource(s: string): s is SyncSource {
  return s in SOURCE_POLICY;
}

export interface AutoBackfillResult {
  filled: Partial<Record<SyncSource, number>>;
  errors: string[];
}

/**
 * Look up the user's connected sources via credential rows (mirrors the
 * helper in /api/sync/run). Apple Watch is excluded — push-only.
 */
async function connectedSources(userId: string): Promise<SyncSource[]> {
  const admin = getAdminClient();
  const [garmin, whoop] = await Promise.all([
    admin
      .from('garmin_credentials')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('whoop_credentials')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  const out: SyncSource[] = [];
  if (garmin.data) out.push('garmin');
  if (whoop.data) out.push('whoop');
  return out;
}

/**
 * The cooldown gate — find the most recent `sync.auto_backfill` row for the
 * user; if it's < AUTO_BACKFILL_COOLDOWN_MS old, we early-out.
 */
async function lastAutoBackfillAt(userId: string): Promise<Date | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('audit_ledger')
    .select('ts')
    .eq('user_id', userId)
    .eq('action', 'sync.auto_backfill')
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.ts) return null;
  const t = new Date(data.ts as string);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Read the user's last 7 days of `biometrics_daily` rows, per-source (NOT the
 * merged view — we need to know which source has which day).
 */
async function readRecentRows(
  userId: string,
  days: number
): Promise<Array<{ date: string; source: string }>> {
  const admin = getAdminClient();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const { data, error } = await admin
    .from('biometrics_daily')
    .select('date, source')
    .eq('user_id', userId)
    .gte('date', cutoffIso);

  if (error) {
    console.error('[backfill] readRecentRows failed', error);
    return [];
  }
  return (data ?? []) as Array<{ date: string; source: string }>;
}

/**
 * Main entry point. Detect per-source gaps over the last 7 days and trigger
 * a sync for each source with gaps.
 *
 * Returns:
 *   - `filled`: keyed by source, the number of new dates with data after
 *     the sync (re-query post-run and diff against the pre-run set).
 *   - `errors`: ['cooldown'] if we early-outed; ['no_sources'] if the user
 *     has zero connected sources; per-source error strings otherwise.
 */
export async function triggerAutoBackfill(
  userId: string
): Promise<AutoBackfillResult> {
  // Cooldown gate.
  const last = await lastAutoBackfillAt(userId);
  if (last && Date.now() - last.getTime() < AUTO_BACKFILL_COOLDOWN_MS) {
    return { filled: {}, errors: ['cooldown'] };
  }

  // Which sources is this user connected to?
  const connected = await connectedSources(userId);
  if (connected.length === 0) {
    return { filled: {}, errors: ['no_sources'] };
  }

  // What rows do we already have?
  const before = await readRecentRows(userId, AUTO_BACKFILL_DAYS);

  // Where are the gaps?
  const gaps = detectGaps(before, connected, AUTO_BACKFILL_DAYS);
  const gapSources = Array.from(gaps.keys());

  if (gapSources.length === 0) {
    // No gaps → still emit an audit row so the cooldown gate trips. Without
    // this, every dashboard load by a user with full data would re-run the
    // gap query.
    await logAudit({
      actor: userId,
      action: 'sync.auto_backfill',
      target: 'biometrics_daily',
      purpose: 'backfill',
      ts: new Date().toISOString(),
      status: 'ok',
      payload: { gaps_detected: {}, filled: {} },
    });
    return { filled: {}, errors: [] };
  }

  // Build a baseline so we can diff afterwards. (source, date) → present.
  const beforeKey = new Set<string>();
  for (const r of before) beforeKey.add(`${r.source}|${r.date.slice(0, 10)}`);

  const errors: string[] = [];
  const perSourceResults: SyncResult[] = [];

  // Run sequentially. The orchestrator already serializes the same
  // (user, sources) tuple via its in-process inflight map, but we still
  // call once per source so the diff math is per-source-clean.
  for (const source of gapSources) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential
      const results = await runSync(userId, [source], {
        days: AUTO_BACKFILL_DAYS,
        force: false,
      });
      const own = results.find((r) => r.source === source);
      if (own) perSourceResults.push(own);
      if (own && own.status === 'error') {
        errors.push(`${source}: ${own.errorMessage ?? 'unknown'}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${source}: ${msg}`);
    }
  }

  // Re-query post-run; diff against the baseline to compute filled counts.
  const after = await readRecentRows(userId, AUTO_BACKFILL_DAYS);
  const afterKey = new Set<string>();
  for (const r of after) afterKey.add(`${r.source}|${r.date.slice(0, 10)}`);

  const filled: Partial<Record<SyncSource, number>> = {};
  for (const source of gapSources) {
    const missing = gaps.get(source) ?? [];
    let count = 0;
    for (const d of missing) {
      if (afterKey.has(`${source}|${d}`) && !beforeKey.has(`${source}|${d}`)) {
        count += 1;
      }
    }
    if (count > 0) filled[source] = count;
  }

  // Emit the gate row so the next dashboard load within the cooldown window
  // skips. We log even when filled is empty (e.g. all gaps hit per-source
  // cooldown) — the gate still needs to trip.
  const gapsForPayload: Record<string, string[]> = {};
  for (const [src, dates] of gaps.entries()) gapsForPayload[src] = dates;

  await logAudit({
    actor: userId,
    action: 'sync.auto_backfill',
    target: 'biometrics_daily',
    purpose: 'backfill',
    ts: new Date().toISOString(),
    status: errors.length > 0 ? 'error' : 'ok',
    payload: {
      gaps_detected: gapsForPayload,
      filled,
      per_source: perSourceResults,
    },
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
  });

  return { filled, errors };
}

/** Re-export so route handlers can introspect without importing policy. */
export { PULLABLE_SOURCES };
