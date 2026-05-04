import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { syncWhoop, WhoopSyncError } from '@/lib/sync/sources/whoop';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/biometrics/sync-whoop[?days=N]
 *
 * Pulls Whoop recovery + cycle + sleep data for the signed-in user. Days
 * window: 1..30. Defaults to 1.
 *
 * Thin wrapper around `syncWhoop`. The orchestrator wraps the same fetcher
 * with cooldown + audit policy; this route exists for the dashboard "Sync
 * Whoop" button which is an explicit user action (no cooldown).
 *
 * Field-mapping rationale and Whoop day-bucketing rules live in
 * `web/src/lib/sync/sources/whoop.ts`.
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
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, daysRaw)) : 1;

  try {
    const result = await syncWhoop({ userId: user.id, days });

    logAudit({
      actor: user.id,
      action: 'biometrics.sync_whoop.success',
      target: 'biometrics_daily',
      purpose: 'biometrics_sync',
      ts: new Date().toISOString(),
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ rows: [], note: 'no whoop data in window' });
    }
    return NextResponse.json({
      biometrics: result.rows[0] ?? null,
      rows: result.rows,
    });
  } catch (err) {
    if (err instanceof WhoopSyncError) {
      const body: Record<string, unknown> = {
        error:
          err.kind === 'not_configured'
            ? 'whoop integration not configured'
            : err.kind === 'not_connected'
              ? 'whoop not connected'
              : err.kind === 'token_refresh_failed'
                ? 'whoop token refresh failed; please reconnect'
                : err.kind === 'upstream_failed'
                  ? 'whoop upstream failed'
                  : 'failed to persist biometrics',
      };
      if (err.missing) body.missing = err.missing;
      if (err.kind === 'upstream_failed') body.detail = err.message;
      return NextResponse.json(body, { status: err.status });
    }
    console.error('[biometrics/sync-whoop] unexpected', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
