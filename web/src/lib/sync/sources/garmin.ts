import type { SupabaseClient } from '@supabase/supabase-js';
import { brokeredFetch } from '@/lib/audit/broker';
import { decryptSecret } from '@/lib/crypto/aes';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * Core Garmin pull. Used by `/api/biometrics/sync` (manual button) and the
 * orchestrator (cron + `/api/sync/run`).
 *
 * Returns `rows` so callers can preserve their existing JSON shape; throws
 * `GarminSyncError` for typed failure modes the orchestrator can map to
 * audit-ledger statuses.
 */

export interface GarminSyncResult {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
}

export class GarminSyncError extends Error {
  readonly kind:
    | 'not_configured'
    | 'no_credentials'
    | 'decrypt_failed'
    | 'upstream_failed'
    | 'persist_failed';
  readonly status: number;
  readonly upstreamStatus?: number;
  constructor(
    kind: GarminSyncError['kind'],
    message: string,
    opts: { status: number; upstreamStatus?: number } = { status: 500 }
  ) {
    super(message);
    this.kind = kind;
    this.status = opts.status;
    this.upstreamStatus = opts.upstreamStatus;
  }
}

interface GarminDayPayload {
  sleep_score: number | null;
  sleep_duration_minutes: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  training_load_acute: number | null;
  training_load_chronic: number | null;
  total_steps: number | null;
  floors_climbed: number | null;
  active_minutes: number | null;
  vigorous_minutes: number | null;
  moderate_minutes: number | null;
  total_kcal_burned: number | null;
  active_kcal_burned: number | null;
  vo2max: number | null;
  max_hr: number | null;
  min_hr: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
  awake_sleep_minutes: number | null;
  sleep_efficiency: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  raw: unknown;
}

interface GarminRangeResponse {
  days: { date: string; biometrics: GarminDayPayload }[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateMinusDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - n);
  return out;
}

function toUpsert(
  userId: string,
  date: string,
  d: GarminDayPayload,
  fetchedAt: string
): Record<string, unknown> {
  return {
    user_id: userId,
    date,
    sleep_score: d.sleep_score,
    sleep_duration_minutes: d.sleep_duration_minutes,
    hrv_ms: d.hrv_ms,
    resting_hr: d.resting_hr,
    stress_avg: d.stress_avg,
    training_load_acute: d.training_load_acute,
    training_load_chronic: d.training_load_chronic,
    total_steps: d.total_steps,
    floors_climbed: d.floors_climbed,
    active_minutes: d.active_minutes,
    vigorous_minutes: d.vigorous_minutes,
    moderate_minutes: d.moderate_minutes,
    total_kcal_burned: d.total_kcal_burned,
    active_kcal_burned: d.active_kcal_burned,
    vo2max: d.vo2max,
    max_hr: d.max_hr,
    min_hr: d.min_hr,
    deep_sleep_minutes: d.deep_sleep_minutes,
    rem_sleep_minutes: d.rem_sleep_minutes,
    light_sleep_minutes: d.light_sleep_minutes,
    awake_sleep_minutes: d.awake_sleep_minutes,
    sleep_efficiency: d.sleep_efficiency,
    body_battery_high: d.body_battery_high,
    body_battery_low: d.body_battery_low,
    body_battery_charged: d.body_battery_charged,
    body_battery_drained: d.body_battery_drained,
    source: 'garmin' as const,
    raw: d.raw,
    fetched_at: fetchedAt,
  };
}

export interface SyncGarminOpts {
  userId: string;
  days?: number;
  /**
   * Supabase client to use for the upsert. The manual route uses the user's
   * RLS-scoped client; the cron path uses the admin client. Falls back to the
   * admin client if not provided.
   */
  writeClient?: SupabaseClient;
}

export async function syncGarmin(opts: SyncGarminOpts): Promise<GarminSyncResult> {
  const days = Number.isFinite(opts.days)
    ? Math.max(1, Math.min(31, Math.floor(opts.days as number)))
    : 1;

  const serviceUrl = process.env.GARMIN_SERVICE_URL;
  const serviceToken = process.env.GARMIN_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) {
    throw new GarminSyncError('not_configured', 'garmin service not configured', {
      status: 503,
    });
  }

  const admin = getAdminClient();
  const { data: creds, error: credsErr } = await admin
    .from('garmin_credentials')
    .select('email, password_encrypted')
    .eq('user_id', opts.userId)
    .maybeSingle();

  if (credsErr || !creds) {
    throw new GarminSyncError('no_credentials', 'no garmin credentials on file', {
      status: 404,
    });
  }

  let plaintextPassword: string;
  try {
    plaintextPassword = decryptSecret(creds.password_encrypted as string);
  } catch (err) {
    console.error('[sync/garmin] decrypt failed', err);
    throw new GarminSyncError('decrypt_failed', 'credential decrypt failed', {
      status: 500,
    });
  }

  const todayDate = new Date();
  const today = isoDay(todayDate);
  const useRange = days > 1;

  const garminRes = await brokeredFetch(
    `${serviceUrl}${useRange ? '/garmin/range' : '/garmin/today'}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(
        useRange
          ? {
              email: creds.email,
              password: plaintextPassword,
              start_date: isoDay(dateMinusDays(todayDate, days - 1)),
              end_date: today,
            }
          : {
              email: creds.email,
              password: plaintextPassword,
              date: today,
            }
      ),
      actor: opts.userId,
      purpose: 'biometrics_sync',
    }
  );

  if (!garminRes.ok) {
    const text = await garminRes.text().catch(() => '');
    console.error('[sync/garmin] upstream', garminRes.status, text);
    throw new GarminSyncError('upstream_failed', `garmin upstream failed: ${garminRes.status}`, {
      status: 502,
      upstreamStatus: garminRes.status,
    });
  }

  const fetchedAt = new Date().toISOString();
  const upserts: Array<Record<string, unknown>> = [];

  if (useRange) {
    const range = (await garminRes.json()) as GarminRangeResponse;
    for (const d of range.days) {
      upserts.push(toUpsert(opts.userId, d.date, d.biometrics, fetchedAt));
    }
  } else {
    const single = (await garminRes.json()) as GarminDayPayload;
    upserts.push(toUpsert(opts.userId, today, single, fetchedAt));
  }

  const writeClient = opts.writeClient ?? admin;
  const { data: rows, error: upsertErr } = await writeClient
    .from('biometrics_daily')
    .upsert(upserts, { onConflict: 'user_id,date,source' })
    .select('*');

  if (upsertErr) {
    console.error('[sync/garmin] upsert error', upsertErr);
    throw new GarminSyncError('persist_failed', 'failed to persist biometrics', {
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
