import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { MODEL_SONNET } from '@/lib/claude/client';
import {
  buildWeeklyReviewInputs,
  computeWeekWindow,
} from '@/lib/coach/weekly-review-collector';
import {
  generateWeeklyReview,
  renderWeeklyReviewMarkdown,
} from '@/lib/coach/weekly-review';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * GET  /api/coach/weekly-review?week_start=YYYY-MM-DD
 *   Returns the persisted review for the calling user. 404 if missing.
 *
 * POST /api/coach/weekly-review?week_start=YYYY-MM-DD
 *   On-demand generation. Idempotent — upserts on (user_id, week_start),
 *   so calling twice within the same week just refreshes the row.
 *
 * `week_start` must be the Monday of a Mon..Sun window. Defaults to the
 * current-most-recent Monday if omitted (i.e. "this week" so far).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function resolveWeekStart(req: Request): { week_start: string; week_end: string } | null {
  const url = new URL(req.url);
  const raw = url.searchParams.get('week_start');
  if (!raw) {
    // Default: the Monday of the just-completed week (Mon..today's-Sun).
    const w = computeWeekWindow(new Date());
    return w;
  }
  if (!ISO_DATE.test(raw)) return null;
  const d = new Date(raw + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  // Caller passes the Monday — treat as the start of the window.
  return computeWeekWindow(d, { fromMonday: true });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const window = resolveWeekStart(req);
  if (!window) {
    return NextResponse.json({ error: 'invalid week_start' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('weekly_reviews')
    .select('*')
    .eq('user_id', user.id)
    .eq('week_start', window.week_start)
    .maybeSingle();
  if (error) {
    console.error('[weekly-review] GET fetch', error);
    return NextResponse.json({ error: 'failed to fetch review' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: 'no review for this week', week_start: window.week_start },
      { status: 404 }
    );
  }
  return NextResponse.json({ review: data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const window = resolveWeekStart(req);
  if (!window) {
    return NextResponse.json({ error: 'invalid week_start' }, { status: 400 });
  }

  const admin = getAdminClient();
  const started = Date.now();
  try {
    const inputs = await buildWeeklyReviewInputs(admin, user.id, window);
    const summary = await generateWeeklyReview(inputs);
    const rendered_md = renderWeeklyReviewMarkdown(summary, inputs);

    await logAudit({
      actor: user.id,
      action: 'claude.messages.create',
      target: 'api.anthropic.com',
      purpose: 'weekly_review',
      ts: new Date().toISOString(),
      status: 'ok',
      msElapsed: Date.now() - started,
    });

    const { data: row, error } = await admin
      .from('weekly_reviews')
      .upsert(
        {
          user_id: user.id,
          week_start: window.week_start,
          summary,
          rendered_md,
          model: MODEL_SONNET,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,week_start' }
      )
      .select('*')
      .single();

    if (error) {
      throw new Error(`weekly_reviews upsert: ${error.message}`);
    }

    await logAudit({
      actor: user.id,
      action: 'weekly_review.generated.success',
      target: 'weekly_reviews',
      purpose: 'weekly_review',
      ts: new Date().toISOString(),
      status: 'ok',
      msElapsed: Date.now() - started,
      rowsAffected: 1,
      payload: { week_start: window.week_start, on_demand: true },
    });

    return NextResponse.json({ review: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weekly-review] POST error', message);
    await logAudit({
      actor: user.id,
      action: 'weekly_review.generated.error',
      target: 'weekly_reviews',
      purpose: 'weekly_review',
      ts: new Date().toISOString(),
      status: 'error',
      msElapsed: Date.now() - started,
      errorMessage: message,
      payload: { week_start: window.week_start, on_demand: true },
    });
    return NextResponse.json(
      { error: 'failed to generate review' },
      { status: 502 }
    );
  }
}
