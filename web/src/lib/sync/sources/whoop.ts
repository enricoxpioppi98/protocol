import { brokeredFetch } from '@/lib/audit/broker';
import { getAdminClient } from '@/lib/supabase/admin';
import {
  getAccessToken,
  readWhoopEnv,
  WHOOP_API_BASE,
} from '@/lib/whoop/client';

/**
 * Core Whoop pull. Field mapping + day-bucketing rules are unchanged from the
 * original `/api/biometrics/sync-whoop` route — see that file's header comment
 * for the rationale on Whoop cycle/sleep day-keying.
 */

export interface WhoopSyncResult {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
}

export class WhoopSyncError extends Error {
  readonly kind:
    | 'not_configured'
    | 'not_connected'
    | 'token_refresh_failed'
    | 'upstream_failed'
    | 'persist_failed';
  readonly status: number;
  readonly missing?: string[];
  constructor(
    kind: WhoopSyncError['kind'],
    message: string,
    opts: { status: number; missing?: string[] } = { status: 500 }
  ) {
    super(message);
    this.kind = kind;
    this.status = opts.status;
    this.missing = opts.missing;
  }
}

interface WhoopSleepStageSummary {
  total_in_bed_time_milli?: number;
  total_awake_time_milli?: number;
  total_no_data_time_milli?: number;
  total_light_sleep_time_milli?: number;
  total_slow_wave_sleep_time_milli?: number;
  total_rem_sleep_time_milli?: number;
}

interface WhoopSleepScore {
  stage_summary?: WhoopSleepStageSummary;
  sleep_performance_percentage?: number;
  sleep_efficiency_percentage?: number;
}

interface WhoopSleep {
  id?: number | string;
  start?: string;
  end?: string;
  timezone_offset?: string;
  nap?: boolean;
  score?: WhoopSleepScore;
}

interface WhoopRecoveryScore {
  recovery_score?: number;
  resting_heart_rate?: number;
  hrv_rmssd_milli?: number;
}

interface WhoopRecovery {
  sleep_id?: number | string;
  score?: WhoopRecoveryScore;
}

interface WhoopCycleScore {
  strain?: number;
  kilojoule?: number;
  max_heart_rate?: number;
}

interface WhoopCycle {
  start?: string;
  timezone_offset?: string;
  score?: WhoopCycleScore;
}

interface WhoopPaged<T> {
  records?: T[];
  next_token?: string | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateMinusDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - n);
  return out;
}

function msToMinutes(ms: number | undefined | null): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return Math.round(ms / 60000);
}

function roundOrNull(n: number | undefined | null): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function numOrNull(n: number | undefined | null): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n;
}

function dayKeyForSleep(sleep: WhoopSleep): string | null {
  if (!sleep.end) return null;
  const offset = sleep.timezone_offset ?? '+00:00';
  const endUtc = new Date(sleep.end);
  if (Number.isNaN(endUtc.getTime())) return null;
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hh, mm] = offset.replace(/^[+-]/, '').split(':');
  const offsetMin = sign * (parseInt(hh ?? '0', 10) * 60 + parseInt(mm ?? '0', 10));
  const local = new Date(endUtc.getTime() + offsetMin * 60_000);
  return local.toISOString().slice(0, 10);
}

function dayKeyForCycle(cycle: WhoopCycle): string | null {
  if (!cycle.start) return null;
  const offset = cycle.timezone_offset ?? '+00:00';
  const startUtc = new Date(cycle.start);
  if (Number.isNaN(startUtc.getTime())) return null;
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hh, mm] = offset.replace(/^[+-]/, '').split(':');
  const offsetMin = sign * (parseInt(hh ?? '0', 10) * 60 + parseInt(mm ?? '0', 10));
  const local = new Date(startUtc.getTime() + offsetMin * 60_000);
  return local.toISOString().slice(0, 10);
}

async function fetchPaged<T>(
  url: string,
  accessToken: string,
  actor: string,
  purpose: string
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;
  for (let i = 0; i < 10; i += 1) {
    const fetchUrl = next
      ? `${url}${url.includes('?') ? '&' : '?'}nextToken=${encodeURIComponent(next)}`
      : url;
    const res = await brokeredFetch(fetchUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      actor,
      purpose,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`whoop ${purpose} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const page = (await res.json()) as WhoopPaged<T>;
    if (page.records) out.push(...page.records);
    if (!page.next_token) break;
    next = page.next_token;
  }
  return out;
}

export interface SyncWhoopOpts {
  userId: string;
  days?: number;
}

export async function syncWhoop(opts: SyncWhoopOpts): Promise<WhoopSyncResult> {
  const days = Number.isFinite(opts.days)
    ? Math.max(1, Math.min(30, Math.floor(opts.days as number)))
    : 1;

  const env = readWhoopEnv();
  if (!env.ok || !env.config) {
    throw new WhoopSyncError('not_configured', 'whoop integration not configured', {
      status: 503,
      missing: env.missing,
    });
  }

  const admin = getAdminClient();
  const { data: creds } = await admin
    .from('whoop_credentials')
    .select('user_id')
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (!creds) {
    throw new WhoopSyncError('not_connected', 'whoop not connected', { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(opts.userId, env.config);
  } catch (err) {
    console.error('[sync/whoop] token refresh failed', err);
    throw new WhoopSyncError(
      'token_refresh_failed',
      'whoop token refresh failed; please reconnect',
      { status: 401 }
    );
  }

  const now = new Date();
  const start = dateMinusDays(now, days);
  start.setHours(start.getHours() - 12);
  const startIso = start.toISOString();
  const endIso = now.toISOString();

  let recoveries: WhoopRecovery[];
  let cycles: WhoopCycle[];
  let sleeps: WhoopSleep[];
  try {
    [recoveries, cycles, sleeps] = await Promise.all([
      fetchPaged<WhoopRecovery>(
        `${WHOOP_API_BASE}/v1/recovery?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=25`,
        accessToken,
        opts.userId,
        'whoop_recovery'
      ),
      fetchPaged<WhoopCycle>(
        `${WHOOP_API_BASE}/v1/cycle?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=25`,
        accessToken,
        opts.userId,
        'whoop_cycle'
      ),
      fetchPaged<WhoopSleep>(
        `${WHOOP_API_BASE}/v1/activity/sleep?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=25`,
        accessToken,
        opts.userId,
        'whoop_sleep'
      ),
    ]);
  } catch (err) {
    console.error('[sync/whoop] upstream error', err);
    throw new WhoopSyncError('upstream_failed', (err as Error).message, { status: 502 });
  }

  const sleepByDay = new Map<string, WhoopSleep>();
  for (const s of sleeps) {
    if (s.nap) continue;
    const key = dayKeyForSleep(s);
    if (!key) continue;
    const existing = sleepByDay.get(key);
    const dur =
      (s.score?.stage_summary?.total_in_bed_time_milli ?? 0) -
      (s.score?.stage_summary?.total_awake_time_milli ?? 0);
    const existingDur = existing
      ? (existing.score?.stage_summary?.total_in_bed_time_milli ?? 0) -
        (existing.score?.stage_summary?.total_awake_time_milli ?? 0)
      : -1;
    if (!existing || dur > existingDur) {
      sleepByDay.set(key, s);
    }
  }

  const cycleByDay = new Map<string, WhoopCycle>();
  for (const c of cycles) {
    const key = dayKeyForCycle(c);
    if (!key) continue;
    const existing = cycleByDay.get(key);
    if (!existing || (c.score?.strain ?? -1) > (existing.score?.strain ?? -1)) {
      cycleByDay.set(key, c);
    }
  }

  const recoveryBySleepId = new Map<string, WhoopRecovery>();
  for (const r of recoveries) {
    if (r.sleep_id !== undefined && r.sleep_id !== null) {
      recoveryBySleepId.set(String(r.sleep_id), r);
    }
  }

  const windowDays = new Set<string>();
  for (let i = 0; i < days; i += 1) {
    windowDays.add(isoDay(dateMinusDays(now, i)));
  }
  const allKeys = new Set<string>([...sleepByDay.keys(), ...cycleByDay.keys()]);

  const fetchedAt = new Date().toISOString();
  const upserts: Array<Record<string, unknown>> = [];

  for (const day of allKeys) {
    if (!windowDays.has(day)) continue;
    const sleep = sleepByDay.get(day);
    const cycle = cycleByDay.get(day);
    const recovery =
      sleep?.id !== undefined && sleep.id !== null
        ? recoveryBySleepId.get(String(sleep.id))
        : undefined;

    const stage = sleep?.score?.stage_summary;
    const inBedMs = stage?.total_in_bed_time_milli ?? 0;
    const awakeMs = stage?.total_awake_time_milli ?? 0;
    const asleepMin = inBedMs > 0 ? msToMinutes(inBedMs - awakeMs) : null;

    upserts.push({
      user_id: opts.userId,
      date: day,
      sleep_score: roundOrNull(sleep?.score?.sleep_performance_percentage),
      sleep_duration_minutes: asleepMin,
      hrv_ms: roundOrNull(recovery?.score?.hrv_rmssd_milli),
      resting_hr: roundOrNull(recovery?.score?.resting_heart_rate),
      stress_avg: null,
      training_load_acute: numOrNull(cycle?.score?.strain),
      training_load_chronic: null,
      total_steps: null,
      floors_climbed: null,
      active_minutes: null,
      vigorous_minutes: null,
      moderate_minutes: null,
      total_kcal_burned:
        typeof cycle?.score?.kilojoule === 'number'
          ? Math.round(cycle.score.kilojoule / 4.184)
          : null,
      active_kcal_burned: null,
      vo2max: null,
      max_hr: roundOrNull(cycle?.score?.max_heart_rate),
      min_hr: null,
      deep_sleep_minutes: msToMinutes(stage?.total_slow_wave_sleep_time_milli),
      rem_sleep_minutes: msToMinutes(stage?.total_rem_sleep_time_milli),
      light_sleep_minutes: msToMinutes(stage?.total_light_sleep_time_milli),
      awake_sleep_minutes: msToMinutes(stage?.total_awake_time_milli),
      sleep_efficiency: numOrNull(sleep?.score?.sleep_efficiency_percentage),
      body_battery_high: null,
      body_battery_low: null,
      body_battery_charged: null,
      body_battery_drained: null,
      source: 'whoop' as const,
      raw: { sleep, cycle, recovery },
      fetched_at: fetchedAt,
    });
  }

  if (upserts.length === 0) {
    return { rows: [], rowsAffected: 0 };
  }

  const { data: rows, error: upsertErr } = await admin
    .from('biometrics_daily')
    .upsert(upserts, { onConflict: 'user_id,date' })
    .select('*');

  if (upsertErr) {
    console.error('[sync/whoop] upsert error', upsertErr);
    throw new WhoopSyncError('persist_failed', 'failed to persist biometrics', {
      status: 500,
    });
  }

  const sorted = (rows ?? []).slice().sort((a, b) =>
    String((b as Record<string, unknown>).date).localeCompare(
      String((a as Record<string, unknown>).date)
    )
  );

  return { rows: sorted, rowsAffected: sorted.length };
}
