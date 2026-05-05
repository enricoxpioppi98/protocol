import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { assembleCoachContext } from '@/lib/coach/context';
import { generateMorningQuestion } from '@/lib/coach/morning-question';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * GET/POST /api/coach/morning-checkin
 *
 * Returns today's morning checkin row. If one already exists for (user, date)
 * it's returned cached. Otherwise the coach generates a single
 * context-aware question via Claude (forced tool-use of
 * emit_morning_question) and the row is upserted.
 *
 * Pass `?regenerate=1` to force a fresh question and clear any prior answer
 * for today.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('regenerate') === '1';
  const today = new Date().toISOString().slice(0, 10);

  if (!force) {
    const { data: existing } = await supabase
      .from('morning_checkins')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ checkin: existing, cached: true });
    }
  }

  // Build context + generate question. Wrap so a flaky model doesn't 500
  // the dashboard — the card just stays hidden if generation fails.
  const ctx = await assembleCoachContext(user.id);
  let q;
  try {
    q = await generateMorningQuestion(ctx);
  } catch (err) {
    console.error('[morning-checkin] generation failed', err);
    return NextResponse.json(
      { error: 'question generation failed' },
      { status: 502 }
    );
  }

  // Service role to bypass RLS — there's no user-side INSERT policy.
  const admin = getAdminClient();
  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    date: today,
    question_text: q.question,
    quick_replies: q.quick_replies,
    rationale: q.rationale || null,
    generated_at: new Date().toISOString(),
  };
  if (force) {
    upsertPayload.answer_text = null;
    upsertPayload.answer_quick_reply_index = null;
    upsertPayload.answered_at = null;
  }

  const { data: row, error } = await admin
    .from('morning_checkins')
    .upsert(upsertPayload, { onConflict: 'user_id,date' })
    .select('*')
    .single();

  if (error) {
    console.error('[morning-checkin] upsert', error);
    return NextResponse.json(
      { error: 'failed to persist checkin' },
      { status: 500 }
    );
  }

  logAudit({
    actor: user.id,
    action: 'morning_checkin.generated',
    target: 'morning_checkins',
    purpose: 'morning_checkin',
    ts: new Date().toISOString(),
  });

  return NextResponse.json({ checkin: row, cached: false });
}
