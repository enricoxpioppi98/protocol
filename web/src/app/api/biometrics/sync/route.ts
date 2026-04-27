import { NextResponse } from 'next/server';
import { brokeredFetch, logAudit } from '@/lib/audit/broker';
import { decryptSecret } from '@/lib/crypto/aes';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/biometrics/sync[?days=N]
 *
 * Pulls Garmin biometrics for the signed-in user and upserts them into
 * `biometrics_daily`. By default fetches today only; pass `?days=N` (1-31) to
 * backfill the last N days inclusive.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GarminDayPayload {
  sleep_score: number | null;
  sleep_duration_minutes: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  training_load_acute: number | null;
  training_load_chronic: number | null;
  raw: unknown;
}

interface GarminRangeResponse {
  days: { date: string; biometrics: GarminDayPayload }[];
}

function dateMinusDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - n);
  return out;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  const days = Number.isFinite(daysRaw)
    ? Math.max(1, Math.min(31, daysRaw))
    : 1;

  const serviceUrl = process.env.GARMIN_SERVICE_URL;
  const serviceToken = process.env.GARMIN_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) {
    return NextResponse.json(
      { error: 'garmin service not configured', fallback: 'manual' },
      { status: 503 }
    );
  }

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

  const todayDate = new Date();
  const today = isoDay(todayDate);

  // Single-day path keeps the simple /garmin/today endpoint.
  // Range path fans out to /garmin/range with ONE login at the service.
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
      actor: user.id,
      purpose: 'biometrics_sync',
    }
  );

  if (!garminRes.ok) {
    const text = await garminRes.text().catch(() => '');
    console.error('[biometrics/sync] garmin upstream', garminRes.status, text);
    return NextResponse.json(
      { error: 'garmin upstream failed', status: garminRes.status, fallback: 'manual' },
      { status: 502 }
    );
  }

  const fetchedAt = new Date().toISOString();
  const upserts: Array<Record<string, unknown>> = [];

  if (useRange) {
    const range = (await garminRes.json()) as GarminRangeResponse;
    for (const d of range.days) {
      upserts.push(toUpsert(user.id, d.date, d.biometrics, fetchedAt));
    }
  } else {
    const single = (await garminRes.json()) as GarminDayPayload;
    upserts.push(toUpsert(user.id, today, single, fetchedAt));
  }

  const { data: rows, error: upsertErr } = await supabase
    .from('biometrics_daily')
    .upsert(upserts, { onConflict: 'user_id,date' })
    .select('*');

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

  // For backwards compatibility with the existing client, return the most
  // recent row as `biometrics` plus the full set as `rows`.
  const sorted = (rows ?? []).slice().sort((a, b) =>
    String((b as Record<string, unknown>).date).localeCompare(
      String((a as Record<string, unknown>).date)
    )
  );
  return NextResponse.json({ biometrics: sorted[0] ?? null, rows: sorted });
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
    source: 'garmin' as const,
    raw: d.raw,
    fetched_at: fetchedAt,
  };
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
