/**
 * Data Health score — a single 0..100 number summarising whether the user's
 * ingestion plumbing is doing its job.
 *
 * Pure function: takes one input object, returns one shape. No DB calls, no
 * date math against `Date.now()` outside of `now` parameter (caller can pin it
 * for deterministic tests). The dashboard's `DataHealthCard` server component
 * gathers the inputs and calls this; nothing else should reimplement the
 * formula.
 *
 * Formula (so the dashboard caption can show its work):
 *
 *   per_source_health = 0.7 * freshness + 0.3 * (1 - error_rate)
 *
 *     freshness :  1.0  if  last_sync ≤ 24h
 *                  0.0  if  last_sync ≥ 7 days (168h)
 *                  linear in between
 *
 *     error_rate = errors / (errors + oks)   in last 24h, 0 if no traffic
 *
 *   score = round( mean(per_source_health for connected sources) * 100 )
 *
 *   bands :  ≥85 green · 60..84 yellow · <60 red · null/no sources gray
 *
 * Disconnected sources don't penalise — the score is over what's connected.
 * Apple Watch is push-only; if connected and recently pushing we still credit
 * it for freshness via its `last_synced_at`.
 */

import { ALL_SYNC_SOURCES, type SyncSource } from './policy';

// --- formula constants (tweak with care; tests below pin the math) ---
export const HEALTH_FRESHNESS_FULL_HOURS = 24; // ≤ this many hours = full credit
export const HEALTH_FRESHNESS_ZERO_HOURS = 24 * 7; // ≥ this many hours = zero credit
export const HEALTH_FRESHNESS_WEIGHT = 0.7;
export const HEALTH_ERROR_WEIGHT = 0.3;
export const HEALTH_BAND_GREEN_MIN = 85;
export const HEALTH_BAND_YELLOW_MIN = 60;

export type HealthBand = 'green' | 'yellow' | 'red' | 'gray';

export interface SourceConnectionState {
  connected: boolean;
  /** ISO timestamp or null if never synced. */
  last_synced_at: string | null;
}

export interface SourceAuditSummary {
  source: SyncSource;
  ok_count: number;
  error_count: number;
}

export interface DataHealthInput {
  connections: Record<SyncSource, SourceConnectionState>;
  /** May omit sources with no audit traffic — treated as 0/0. */
  audit_24h: SourceAuditSummary[];
  /** For deterministic tests; defaults to Date.now() at call time. */
  now?: number;
}

export interface PerSourceHealth {
  source: SyncSource;
  /** 'connected' | 'disconnected' | 'stale' (connected but ≥ 7d no sync) */
  status: 'connected' | 'disconnected' | 'stale';
  /** Hours since last sync, null if never synced or disconnected. */
  freshness_hours: number | null;
  /** 0..1 share of failures in last 24h, 0 if no traffic. */
  error_rate_24h: number;
  /** 0..1 health for this source (only meaningful if connected). */
  contribution: number;
}

export interface DataHealthResult {
  /** 0..100 rounded, or null if no sources connected. */
  score: number | null;
  band: HealthBand;
  per_source: PerSourceHealth[];
}

/**
 * Compute freshness 0..1 from hours-since-last-sync.
 *
 *   ≤ 24h        → 1.0
 *   ≥ 168h (7d)  → 0.0
 *   between      → linear decay
 *
 * Exported for the rare case the card UI wants the same curve for a single
 * source (e.g. drawing a tiny meter).
 */
export function freshnessScore(hoursSinceSync: number | null): number {
  if (hoursSinceSync === null) return 0;
  if (hoursSinceSync <= HEALTH_FRESHNESS_FULL_HOURS) return 1;
  if (hoursSinceSync >= HEALTH_FRESHNESS_ZERO_HOURS) return 0;
  const span = HEALTH_FRESHNESS_ZERO_HOURS - HEALTH_FRESHNESS_FULL_HOURS;
  const into = hoursSinceSync - HEALTH_FRESHNESS_FULL_HOURS;
  return 1 - into / span;
}

function bandFor(score: number | null): HealthBand {
  if (score === null) return 'gray';
  if (score >= HEALTH_BAND_GREEN_MIN) return 'green';
  if (score >= HEALTH_BAND_YELLOW_MIN) return 'yellow';
  return 'red';
}

function hoursBetween(nowMs: number, iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / (60 * 60 * 1000));
}

export function computeDataHealth(input: DataHealthInput): DataHealthResult {
  const nowMs = input.now ?? Date.now();

  // Roll the audit array into a quick lookup. Sources with no traffic in 24h
  // get 0/0 and an error_rate of 0 (which is the right default — "no syncs
  // ran" shouldn't punish a freshly-connected user).
  const auditBySource = new Map<SyncSource, SourceAuditSummary>();
  for (const row of input.audit_24h) {
    auditBySource.set(row.source, row);
  }

  const perSource: PerSourceHealth[] = ALL_SYNC_SOURCES.map((source) => {
    const conn = input.connections[source] ?? {
      connected: false,
      last_synced_at: null,
    };
    const audit = auditBySource.get(source);
    const okCount = audit?.ok_count ?? 0;
    const errCount = audit?.error_count ?? 0;
    const total = okCount + errCount;
    const errorRate = total === 0 ? 0 : errCount / total;
    const hours = hoursBetween(nowMs, conn.last_synced_at);
    const fresh = freshnessScore(hours);
    const contribution =
      HEALTH_FRESHNESS_WEIGHT * fresh + HEALTH_ERROR_WEIGHT * (1 - errorRate);

    let status: PerSourceHealth['status'];
    if (!conn.connected) status = 'disconnected';
    else if (hours === null || hours >= HEALTH_FRESHNESS_ZERO_HOURS) status = 'stale';
    else status = 'connected';

    return {
      source,
      status,
      freshness_hours: hours,
      error_rate_24h: errorRate,
      contribution,
    };
  });

  const connectedContribs = perSource
    .filter((p) => input.connections[p.source]?.connected)
    .map((p) => p.contribution);

  if (connectedContribs.length === 0) {
    return { score: null, band: 'gray', per_source: perSource };
  }

  const mean =
    connectedContribs.reduce((a, b) => a + b, 0) / connectedContribs.length;
  const score = Math.round(mean * 100);
  return { score, band: bandFor(score), per_source: perSource };
}

/* ============================================================================
 * Inline test cases (uncomment + run in any sandbox to verify the math).
 * Kept here because there's no test runner wired up yet (`web/tests/` has only
 * a Playwright scaffold). Once a runner lands, lift these into
 * `health-score.test.ts` verbatim.
 *
 * import { computeDataHealth } from './health-score';
 *
 * const NOW = new Date('2026-05-04T12:00:00Z').getTime();
 * const hoursAgo = (h: number) =>
 *   new Date(NOW - h * 60 * 60 * 1000).toISOString();
 *
 * // 1. All 3 sources connected, all synced 1h ago, no errors → ~100, green
 * {
 *   const r = computeDataHealth({
 *     now: NOW,
 *     connections: {
 *       garmin:      { connected: true, last_synced_at: hoursAgo(1) },
 *       whoop:       { connected: true, last_synced_at: hoursAgo(1) },
 *       apple_watch: { connected: true, last_synced_at: hoursAgo(1) },
 *     },
 *     audit_24h: [],
 *   });
 *   console.assert(r.score === 100 && r.band === 'green', '#1', r);
 * }
 *
 * // 2. Whoop disconnected, Garmin 2d ago, Apple Watch 6h ago → freshness decay
 * //    Garmin freshness = 1 - (48-24)/(168-24) = 1 - 24/144 ≈ 0.833
 * //      → contribution = 0.7*0.833 + 0.3*1 = 0.883
 * //    Apple Watch (6h) → freshness 1.0 → contribution 1.0
 * //    Mean of two = 0.9417  → score 94, green
 * {
 *   const r = computeDataHealth({
 *     now: NOW,
 *     connections: {
 *       garmin:      { connected: true,  last_synced_at: hoursAgo(48) },
 *       whoop:       { connected: false, last_synced_at: null },
 *       apple_watch: { connected: true,  last_synced_at: hoursAgo(6) },
 *     },
 *     audit_24h: [],
 *   });
 *   console.assert(r.score === 94 && r.band === 'green', '#2', r);
 * }
 *
 * // 3. All connected fresh, but Whoop has 5 ok / 5 err in 24h
 * //    Whoop contribution = 0.7*1.0 + 0.3*(1 - 0.5) = 0.85
 * //    Garmin + Apple = 1.0 each
 * //    Mean = (1 + 0.85 + 1) / 3 = 0.95  → score 95, green
 * {
 *   const r = computeDataHealth({
 *     now: NOW,
 *     connections: {
 *       garmin:      { connected: true, last_synced_at: hoursAgo(2) },
 *       whoop:       { connected: true, last_synced_at: hoursAgo(2) },
 *       apple_watch: { connected: true, last_synced_at: hoursAgo(2) },
 *     },
 *     audit_24h: [{ source: 'whoop', ok_count: 5, error_count: 5 }],
 *   });
 *   console.assert(r.score === 95 && r.band === 'green', '#3', r);
 * }
 *
 * // 4. Zero sources connected → null + gray
 * {
 *   const r = computeDataHealth({
 *     now: NOW,
 *     connections: {
 *       garmin:      { connected: false, last_synced_at: null },
 *       whoop:       { connected: false, last_synced_at: null },
 *       apple_watch: { connected: false, last_synced_at: null },
 *     },
 *     audit_24h: [],
 *   });
 *   console.assert(r.score === null && r.band === 'gray', '#4', r);
 * }
 *
 * // 5. Empty audit on a fresh user → no crash, freshness alone drives score.
 * {
 *   const r = computeDataHealth({
 *     now: NOW,
 *     connections: {
 *       garmin:      { connected: true, last_synced_at: hoursAgo(1) },
 *       whoop:       { connected: false, last_synced_at: null },
 *       apple_watch: { connected: false, last_synced_at: null },
 *     },
 *     audit_24h: [],
 *   });
 *   console.assert(r.score === 100 && r.band === 'green', '#5', r);
 * }
 * ========================================================================= */
