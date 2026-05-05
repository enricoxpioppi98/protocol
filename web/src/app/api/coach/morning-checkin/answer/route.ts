import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/coach/morning-checkin/answer
 *
 * Body: { answer_text?: string, answer_quick_reply_index?: number }
 *
 * Persists the user's answer onto today's morning_checkin row. The answer
 * is also mirrored as a chat_message so it's part of the recall corpus
 * (and shows up in the chat history). The dashboard then triggers a
 * briefing regenerate so the answer can shape today's plan.
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

  const body = (await req.json().catch(() => null)) as
    | { answer_text?: unknown; answer_quick_reply_index?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const answerText =
    typeof body.answer_text === 'string' && body.answer_text.trim()
      ? body.answer_text.trim().slice(0, 500)
      : null;
  const quickIdx =
    typeof body.answer_quick_reply_index === 'number' &&
    Number.isInteger(body.answer_quick_reply_index) &&
    body.answer_quick_reply_index >= 0 &&
    body.answer_quick_reply_index < 3
      ? body.answer_quick_reply_index
      : null;

  if (!answerText && quickIdx === null) {
    return NextResponse.json({ error: 'no answer provided' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: row, error } = await supabase
    .from('morning_checkins')
    .update({
      answer_text: answerText,
      answer_quick_reply_index: quickIdx,
      answered_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('date', today)
    .select('*')
    .single();

  if (error || !row) {
    console.error('[morning-checkin/answer]', error);
    return NextResponse.json(
      { error: 'no checkin to answer for today' },
      { status: 404 }
    );
  }

  // Mirror the Q+A as a chat_message so it's part of the recall corpus
  // (and so the next briefing regen has the answer in context). Best-effort
  // — failing here shouldn't 500 the answer flow.
  try {
    const replyDisplay =
      answerText ??
      (typeof row.quick_replies?.[quickIdx ?? -1] === 'string'
        ? (row.quick_replies as string[])[quickIdx as number]
        : '(no answer)');
    const summary = `[morning checkin] Q: ${row.question_text}\nA: ${replyDisplay}`;
    await supabase.from('chat_messages').insert({
      user_id: user.id,
      role: 'user',
      content: summary,
      tools: [],
    });
  } catch (err) {
    console.error('[morning-checkin/answer] chat mirror failed', err);
  }

  logAudit({
    actor: user.id,
    action: 'morning_checkin.answered',
    target: 'morning_checkins',
    purpose: 'morning_checkin',
    ts: new Date().toISOString(),
  });

  return NextResponse.json({ checkin: row });
}
