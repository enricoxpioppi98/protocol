import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { getAdminClient } from '@/lib/supabase/admin';
import {
  buildWeeklyReviewInputs,
  computeWeekWindow,
  type WeekWindow,
} from '@/lib/coach/weekly-review-collector';
import {
  generateWeeklyReview,
  renderWeeklyReviewMarkdown,
} from '@/lib/coach/weekly-review';
import { MODEL_SONNET } from '@/lib/claude/client';

/**
 * GET/POST /api/coach/weekly-review/cron
 *
 * Vercel Cron entry point. Fires Sunday 19:00 UTC. For each user with at
 * least 3 days of biometrics in the just-completed week, build the inputs
 * and call `generateWeeklyReview`, then upsert into `weekly_reviews`.
 *
 * Bounded by ROW_LIMIT_PER_CALL so a flurry of new users can't blow the
 * tick budget. Re-running the cron the next minute drains the queue.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ROW_LIMIT_PER_CALL = 20;
const MIN_BIO_DAYS = 3;

interface UserResult {
  user_id: string;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === secret;
}

async function listCandidateUsers(
  admin: ReturnType<typeof getAdminClient>,
  window: WeekWindow
): Promise<string[]> {
  // Pull every (user_id, date) row in the merged view for the window.
  // Filter in JS to users with >= MIN_BIO_DAYS distinct dates.
  const { data, error } = await admin
    .from('biometrics_daily_merged')
    .select('user_id, date')
    .gte('date', window.week_start)
    .lte('date', window.week_end);
  if (error) {
    throw new Error(`biometrics_daily_merged fetch: ${error.message}`);
  }
  const counts = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{ user_id: string; date: string }>) {
    const set = counts.get(row.user_id) ?? new Set<string>();
    set.add(row.date);
    counts.set(row.user_id, set);
  }
  const eligible: string[] = [];
  for (const [uid, dates] of counts) {
    if (dates.size >= MIN_BIO_DAYS) eligible.push(uid);
  }
  eligible.sort();
  return eligible;
}

async function handle(req: Request): Promise<Response> {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  // Optional override for ad-hoc runs / testing: ?week_start=YYYY-MM-DD.
  const overrideStart = url.searchParams.get('week_start');
  const window = overrideStart
    ? computeWeekWindow(new Date(overrideStart + 'T12:00:00Z'), { fromMonday: true })
    : computeWeekWindow(new Date());

  const admin = getAdminClient();

  let candidates: string[];
  try {
    candidates = await listCandidateUsers(admin, window);
  } catch (err) {
    console.error('[weekly-review/cron] candidates fetch', err);
    return NextResponse.json(
      { error: 'failed to enumerate candidates' },
      { status: 500 }
    );
  }

  let processed = 0;
  let generated = 0;
  const results: UserResult[] = [];

  for (const userId of candidates) {
    if (processed >= ROW_LIMIT_PER_CALL) {
      results.push({ user_id: userId, status: 'skipped' });
      continue;
    }
    processed += 1;
    const started = Date.now();
    try {
      const inputs = await buildWeeklyReviewInputs(admin, userId, window);
      const summary = await generateWeeklyReview(inputs);
      const rendered_md = renderWeeklyReviewMarkdown(summary, inputs);

      await logAudit({
        actor: userId,
        action: 'claude.messages.create',
        target: 'api.anthropic.com',
        purpose: 'weekly_review',
        ts: new Date().toISOString(),
        status: 'ok',
        msElapsed: Date.now() - started,
      });

      const { error: upsertErr } = await admin
        .from('weekly_reviews')
        .upsert(
          {
            user_id: userId,
            week_start: window.week_start,
            summary,
            rendered_md,
            model: MODEL_SONNET,
            generated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,week_start' }
        );

      if (upsertErr) {
        throw new Error(`weekly_reviews upsert: ${upsertErr.message}`);
      }

      await logAudit({
        actor: userId,
        action: 'weekly_review.generated.success',
        target: 'weekly_reviews',
        purpose: 'weekly_review',
        ts: new Date().toISOString(),
        status: 'ok',
        msElapsed: Date.now() - started,
        rowsAffected: 1,
        payload: { week_start: window.week_start },
      });

      generated += 1;
      results.push({ user_id: userId, status: 'ok' });
    } catch (err) {
      const message = errorMessageOf(err);
      console.error(
        '[weekly-review/cron] user error',
        userId,
        window.week_start,
        message
      );
      await logAudit({
        actor: userId,
        action: 'weekly_review.generated.error',
        target: 'weekly_reviews',
        purpose: 'weekly_review',
        ts: new Date().toISOString(),
        status: 'error',
        msElapsed: Date.now() - started,
        errorMessage: message,
        payload: { week_start: window.week_start },
      });
      results.push({ user_id: userId, status: 'error', error: message });
    }
  }

  return NextResponse.json({
    week_start: window.week_start,
    week_end: window.week_end,
    candidates: candidates.length,
    processed,
    generated,
    row_limit: ROW_LIMIT_PER_CALL,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}
