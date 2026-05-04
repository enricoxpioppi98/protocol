import { NextResponse } from 'next/server';
import { brokeredFetch, logAudit } from '@/lib/audit/broker';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  getAccessToken,
  readWhoopEnv,
  WHOOP_API_BASE,
} from '@/lib/whoop/client';

/**
 * POST /api/biometrics/sync-whoop[?days=N]
 *
 * Pulls Whoop recovery + cycle + sleep data for the signed-in user and upserts
 * one row per day into `biometrics_daily` with source='whoop'. Defaults to 1
 * day; capped at 30.
 *
 * Token lifecycle: `getAccessToken` lazily refreshes the Whoop access token
 * (and persists the rotated refresh token) if the cached one is missing or
 * within 60s of expiry.
 *
 * Field mapping (Whoop -> biometrics_daily):
 *   sleep performance % .................. sleep_score
 *   sleep duration  (sec -> min) ......... sleep_duration_minutes
 *   HRV RMSSD       (ms) ................. hrv_ms
 *   resting HR ........................... resting_hr
 *   strain          (0-21 Whoop scale) ... training_load_acute
 *   sleep stages    (sec -> min) ......... deep/rem/light/awake_sleep_minutes
 *   sleep efficiency % ................... sleep_efficiency
 *   full Whoop payload .................... raw (jsonb)
 *
 * NOTE on training_load_acute: Whoop strain is a 0-21 logarithmic scale; it is
 * NOT the same unit as Garmin's acute training load (EPOC / TRIMP-based,
 * effectively unbounded). They share a column purely as a "current load"
 * signal. The dashboard formats this column based on the row's `source` so
 * the user sees the right semantics. Do not average across sources.
 *
 * Conflict resolution on (user_id, date): we upsert with `onConflict: user_id,date`
 * and the row's `source` becomes the most recently written source. If the
 * user has both Garmin AND Whoop and runs both syncs on the same day, the
 * latest-write wins — including the `source` column. This is the documented
 * v1 strategy; a follow-up could merge per-column from richer sources.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WhoopSleepStageSummary {
  total_in_bed_time_milli?: number;
  total_awake_time_milli?: number;
  total_no_data_time_milli?: number;
  total_light_sleep_time_milli?: number;
  total_slow_wave_sleep_time_milli?: number;
  total_rem_sleep_time_milli?: number;
  sleep_cycle_count?: number;
  disturbance_count?: number;
}

interface WhoopSleepScore {
  stage_summary?: WhoopSleepStageSummary;
  sleep_needed?: {
    baseline_milli?: number;
    need_from_sleep_debt_milli?: number;
    need_from_recent_strain_milli?: number;
    need_from_recent_nap_milli?: number;
  };
  respiratory_rate?: number;
  sleep_performance_percentage?: number;
  sleep_consistency_percentage?: number;
  sleep_efficiency_percentage?: number;
}

interface WhoopSleep {
  id?: number | string;
  user_id?: number | string;
  start?: string;
  end?: string;
  timezone_offset?: string;
  nap?: boolean;
  score_state?: string;
  score?: WhoopSleepScore;
}

interface WhoopRecoveryScore {
  user_calibrating?: boolean;
  recovery_score?: number;
  resting_heart_rate?: number;
  hrv_rmssd_milli?: number;
  spo2_percentage?: number;
  skin_temp_celsius?: number;
}

interface WhoopRecovery {
  cycle_id?: number | string;
  sleep_id?: number | string;
  user_id?: number | string;
  created_at?: string;
  updated_at?: string;
  score_state?: string;
  score?: WhoopRecoveryScore;
}

interface WhoopCycleScore {
  strain?: number;
  kilojoule?: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
}

interface WhoopCycle {
  id?: number | string;
  user_id?: number | string;
  created_at?: string;
  updated_at?: string;
  start?: string;
  end?: string | null;
  timezone_offset?: string;
  score_state?: string;
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

/**
 * Whoop's "cycle" boundaries are anchored to the user's wake time, not midnight.
 * For a given Whoop sleep (which spans into the morning), the local-calendar
 * date that "owns" the row is the wake-up date — i.e. the END of the sleep,
 * shifted by the timezone offset Whoop returns. This matches how a user
 * thinks about "last night's sleep" on a dashboard.
 */
function dayKeyForSleep(sleep: WhoopSleep): string | null {
  if (!sleep.end) return null;
  const offset = sleep.timezone_offset ?? '+00:00';
  // ISO 8601 with offset: parse to UTC then shift by offset minutes.
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
  // Cap pages so a buggy server response can't trap us in a loop.
  for (let i = 0; i < 10; i += 1) {
    const fetchUrl = next ? `${url}${url.includes('?') ? '&' : '?'}nextToken=${encodeURIComponent(next)}` : url;
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

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get('days') ?? '1', 10);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, daysRaw)) : 1;

  const env = readWhoopEnv();
  if (!env.ok || !env.config) {
    return NextResponse.json(
      { error: 'whoop integration not configured', missing: env.missing },
      { status: 503 }
    );
  }

  const admin = getAdminClient();
  const { data: creds } = await admin
    .from('whoop_credentials')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!creds) {
    return NextResponse.json(
      { error: 'whoop not connected' },
      { status: 404 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(user.id, env.config);
  } catch (err) {
    console.error('[sync-whoop] token refresh failed', err);
    return NextResponse.json(
      { error: 'whoop token refresh failed; please reconnect' },
      { status: 401 }
    );
  }

  // Whoop range filters use ISO 8601 timestamps. Pull a window slightly wider
  // than the requested calendar days so we capture sleeps whose wake time
  // falls inside the window.
  const now = new Date();
  const start = dateMinusDays(now, days);
  // Walk back another 12h so a sleep that started yesterday-evening but ended
  // within `start`'s window is captured.
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
        user.id,
        'whoop_recovery'
      ),
      fetchPaged<WhoopCycle>(
        `${WHOOP_API_BASE}/v1/cycle?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=25`,
        accessToken,
        user.id,
        'whoop_cycle'
      ),
      fetchPaged<WhoopSleep>(
        `${WHOOP_API_BASE}/v1/activity/sleep?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=25`,
        accessToken,
        user.id,
        'whoop_sleep'
      ),
    ]);
  } catch (err) {
    console.error('[sync-whoop] upstream error', err);
    return NextResponse.json(
      { error: 'whoop upstream failed', detail: (err as Error).message },
      { status: 502 }
    );
  }

  // Index each list by local-calendar day. For sleep we prefer the longest
  // non-nap sleep per day. For cycles we take the cycle whose start anchors
  // to the day. Recoveries are 1:1 with sleeps via sleep_id, so we attach
  // them after sleeps are bucketed.
  const sleepByDay = new Map<string, WhoopSleep>();
  for (const s of sleeps) {
    if (s.nap) continue;
    const key = dayKeyForSleep(s);
    if (!key) continue;
    const existing = sleepByDay.get(key);
    const dur = (s.score?.stage_summary?.total_in_bed_time_milli ?? 0)
      - (s.score?.stage_summary?.total_awake_time_milli ?? 0);
    const existingDur = existing
      ? (existing.score?.stage_summary?.total_in_bed_time_milli ?? 0)
        - (existing.score?.stage_summary?.total_awake_time_milli ?? 0)
      : -1;
    if (!existing || dur > existingDur) {
      sleepByDay.set(key, s);
    }
  }

  const cycleByDay = new Map<string, WhoopCycle>();
  for (const c of cycles) {
    const key = dayKeyForCycle(c);
    if (!key) continue;
    // If multiple cycles touch the same day (rare), pick the one with the
    // higher strain score so we don't pick a half-finished cycle.
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

  // Constrain output to the requested calendar window.
  const windowDays = new Set<string>();
  for (let i = 0; i < days; i += 1) {
    windowDays.add(isoDay(dateMinusDays(now, i)));
  }
  const allKeys = new Set<string>([
    ...sleepByDay.keys(),
    ...cycleByDay.keys(),
  ]);

  const fetchedAt = new Date().toISOString();
  const upserts: Array<Record<string, unknown>> = [];

  for (const day of allKeys) {
    if (!windowDays.has(day)) continue;
    const sleep = sleepByDay.get(day);
    const cycle = cycleByDay.get(day);
    const recovery = sleep?.id !== undefined && sleep.id !== null
      ? recoveryBySleepId.get(String(sleep.id))
      : undefined;

    const stage = sleep?.score?.stage_summary;
    const inBedMs = stage?.total_in_bed_time_milli ?? 0;
    const awakeMs = stage?.total_awake_time_milli ?? 0;
    // Whoop reports total_in_bed which includes awake time; biometrics_daily's
    // sleep_duration_minutes is "time asleep" — subtract awake to align.
    const asleepMin = inBedMs > 0 ? msToMinutes(inBedMs - awakeMs) : null;

    upserts.push({
      user_id: user.id,
      date: day,
      sleep_score: roundOrNull(sleep?.score?.sleep_performance_percentage),
      sleep_duration_minutes: asleepMin,
      hrv_ms: roundOrNull(recovery?.score?.hrv_rmssd_milli),
      resting_hr: roundOrNull(recovery?.score?.resting_heart_rate),
      stress_avg: null, // Whoop has no analogue to Garmin's stress score
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
    return NextResponse.json({ rows: [], note: 'no whoop data in window' });
  }

  // PK is (user_id, date, source) as of migration 013. Whoop rows now coexist
  // with Garmin/Apple Watch rows for the same date instead of overwriting
  // them — read sites pull from `biometrics_daily_merged` which picks the
  // priority winner per metric. (Pre-013 this was a v1-era latest-write-wins
  // path that silently dropped overlapping data.)
  const { data: rows, error: upsertErr } = await admin
    .from('biometrics_daily')
    .upsert(upserts, { onConflict: 'user_id,date,source' })
    .select('*');

  if (upsertErr) {
    console.error('[sync-whoop] upsert error', upsertErr);
    return NextResponse.json({ error: 'failed to persist biometrics' }, { status: 500 });
  }

  logAudit({
    actor: user.id,
    action: 'biometrics.sync_whoop.success',
    target: 'biometrics_daily',
    purpose: 'biometrics_sync',
    ts: new Date().toISOString(),
  });

  const sorted = (rows ?? []).slice().sort((a, b) =>
    String((b as Record<string, unknown>).date).localeCompare(
      String((a as Record<string, unknown>).date)
    )
  );
  return NextResponse.json({ biometrics: sorted[0] ?? null, rows: sorted });
}
