import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ChatMessage } from '@/lib/types/models';

/**
 * GET /api/chat/history — last 50 chat messages for the signed-in user,
 * oldest first (so the UI can append in order).
 *
 * DELETE /api/chat/history — wipe the entire chat history for the user.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 50;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Pull the most recent N rows (desc), then flip to ascending for the UI.
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = ((data ?? []) as ChatMessage[]).slice().reverse();
  return NextResponse.json({ messages });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { error } = await supabase
    .from('chat_messages')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
