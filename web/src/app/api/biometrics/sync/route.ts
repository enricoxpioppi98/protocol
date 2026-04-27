import { NextResponse } from 'next/server';
import { brokeredFetch, logAudit } from '@/lib/audit/broker';
import { decryptSecret } from '@/lib/crypto/aes';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/biometrics/sync
 *
 * Pulls today's Garmin biometrics for the signed-in user and upserts them into
 * `biometrics_daily`. The user must have stored Garmin credentials via
 * /settings/integrations beforehand. If the Garmin service is misconfigured
 * or the call fails, we surface a clear error and the UI falls back to the
 * manual entry form.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GarminTodayResponse {
  sleep_score: number | null;
  sleep_duration_minutes: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  training_load_acute: number | null;
  training_load_chronic: number | null;
  raw: unknown;
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const serviceUrl = process.env.GARMIN_SERVICE_URL;
  const serviceToken = process.env.GARMIN_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) {
    return NextResponse.json(
      { error: 'garmin service not configured', fallback: 'manual' },
      { status: 503 }
    );
  }

  // Read encrypted creds via service-role client (no SELECT policy on
  // garmin_credentials for authenticated users).
  const admin = getAdminClient();
  const { data: creds, error: credsErr } = await admin
    .from('garmin_credentials')
    .select('email, password_encrypted')
    .eq('user_id', user.id)
    .maybeSingle();

  if (credsErr || !creds) {
    return NextResponse.json(
      { error: 'no garmin credentials on file', fallback: 'manual' },
      { status: 404 }
    );
  }

  let plaintextPassword: string;
  try {
    plaintextPassword = decryptSecret(creds.password_encrypted as string);
  } catch (err) {
    console.error('[biometrics/sync] decrypt failed', err);
    return NextResponse.json(
      { error: 'credential decrypt failed', fallback: 'manual' },
      { status: 500 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const garminRes = await brokeredFetch(`${serviceUrl}/garmin/today`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceToken}`,
    },
    body: JSON.stringify({
      email: creds.email,
      password: plaintextPassword,
      date: today,
    }),
    actor: user.id,
    purpose: 'biometrics_sync',
  });

  if (!garminRes.ok) {
    const text = await garminRes.text().catch(() => '');
    console.error('[biometrics/sync] garmin upstream', garminRes.status, text);
    return NextResponse.json(
      { error: 'garmin upstream failed', status: garminRes.status, fallback: 'manual' },
      { status: 502 }
    );
  }

  const data = (await garminRes.json()) as GarminTodayResponse;

  const upsertPayload = {
    user_id: user.id,
    date: today,
    sleep_score: data.sleep_score,
    sleep_duration_minutes: data.sleep_duration_minutes,
    hrv_ms: data.hrv_ms,
    resting_hr: data.resting_hr,
    stress_avg: data.stress_avg,
    training_load_acute: data.training_load_acute,
    training_load_chronic: data.training_load_chronic,
    source: 'garmin' as const,
    raw: data.raw,
    fetched_at: new Date().toISOString(),
  };

  const { data: row, error: upsertErr } = await supabase
    .from('biometrics_daily')
    .upsert(upsertPayload, { onConflict: 'user_id,date' })
    .select('*')
    .single();

  if (upsertErr) {
    console.error('[biometrics/sync] upsert error', upsertErr);
    return NextResponse.json({ error: 'failed to persist biometrics' }, { status: 500 });
  }

  logAudit({
    actor: user.id,
    action: 'biometrics.sync.success',
    target: 'biometrics_daily',
    purpose: 'biometrics_sync',
    ts: new Date().toISOString(),
  });

  return NextResponse.json({ biometrics: row });
}

/**
 * PUT /api/biometrics/sync — manual entry fallback.
 * Body: { sleep_score?, sleep_duration_minutes?, hrv_ms?, resting_hr?, stress_avg? }
 */
export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;

  const upsertPayload = {
    user_id: user.id,
    date: today,
    sleep_score: numOrNull(body.sleep_score),
    sleep_duration_minutes: numOrNull(body.sleep_duration_minutes),
    hrv_ms: numOrNull(body.hrv_ms),
    resting_hr: numOrNull(body.resting_hr),
    stress_avg: numOrNull(body.stress_avg),
    training_load_acute: numOrNull(body.training_load_acute),
    training_load_chronic: numOrNull(body.training_load_chronic),
    source: 'manual' as const,
    raw: null,
    fetched_at: new Date().toISOString(),
  };

  const { data: row, error: upsertErr } = await supabase
    .from('biometrics_daily')
    .upsert(upsertPayload, { onConflict: 'user_id,date' })
    .select('*')
    .single();

  if (upsertErr) {
    console.error('[biometrics/sync PUT] upsert error', upsertErr);
    return NextResponse.json({ error: 'failed to persist biometrics' }, { status: 500 });
  }

  return NextResponse.json({ biometrics: row });
}
