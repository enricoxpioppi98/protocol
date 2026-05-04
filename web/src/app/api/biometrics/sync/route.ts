import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { GarminSyncError, syncGarmin } from '@/lib/sync/sources/garmin';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/biometrics/sync[?days=N]
 *
 * Pulls Garmin biometrics for the signed-in user and upserts them into
 * `biometrics_daily`. By default fetches today only; pass `?days=N` (1-31) to
 * backfill the last N days inclusive.
 *
 * Thin wrapper around `syncGarmin`. The orchestrator (`/api/sync/run`,
 * `/api/sync/cron`) wraps the same fetcher with cooldown + audit policy.
 * This route exists for the dashboard "Pull N days" button — that's an
 * explicit user action, so cooldown doesn't apply. Response shape is
 * preserved for backward compat: `{ biometrics: row|null, rows: row[] }`.
 *
 * Errors are returned with the original HTTP statuses (404, 502, 503, etc.)
 * rather than the orchestrator's collapsed `{status:'error'}` shape, because
 * the dashboard reads `error`/`fallback` to decide which UI to show.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  try {
    const result = await syncGarmin({
      userId: user.id,
      days,
      writeClient: supabase,
    });

    logAudit({
      actor: user.id,
      action: 'biometrics.sync.success',
      target: 'biometrics_daily',
      purpose: 'biometrics_sync',
      ts: new Date().toISOString(),
    });

    return NextResponse.json({
      biometrics: result.rows[0] ?? null,
      rows: result.rows,
    });
  } catch (err) {
    if (err instanceof GarminSyncError) {
      const fallback =
        err.kind === 'not_configured' || err.kind === 'no_credentials'
          ? 'manual'
          : undefined;
      return NextResponse.json(
        {
          error:
            err.kind === 'no_credentials'
              ? 'no garmin credentials on file'
              : err.kind === 'not_configured'
                ? 'garmin service not configured'
                : err.kind === 'upstream_failed'
                  ? 'garmin upstream failed'
                  : err.kind === 'decrypt_failed'
                    ? 'credential decrypt failed'
                    : 'failed to persist biometrics',
          ...(err.upstreamStatus !== undefined ? { status: err.upstreamStatus } : {}),
          ...(fallback ? { fallback } : {}),
        },
        { status: err.status }
      );
    }
    console.error('[biometrics/sync] unexpected', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
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
