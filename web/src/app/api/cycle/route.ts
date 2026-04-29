import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * /api/cycle
 *
 *   POST   { start_date, duration_days?, notes? }
 *          → insert one period-start entry. duration_days defaults to 5
 *            (the migration column default), clamped to [1, 14] mirroring the
 *            CHECK constraint. (user_id, start_date) is unique — duplicate
 *            inserts return a 409.
 *   DELETE ?id=<uuid>
 *          → delete one entry. RLS scopes to the authed user.
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
    | {
        start_date?: unknown;
        duration_days?: unknown;
        notes?: unknown;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: 'expected JSON body' }, { status: 400 });
  }

  const startDate =
    typeof body.start_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.start_date)
      ? body.start_date.slice(0, 10)
      : null;
  if (!startDate) {
    return NextResponse.json(
      { error: 'start_date required (YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  let durationDays = 5;
  if (
    typeof body.duration_days === 'number' &&
    Number.isFinite(body.duration_days)
  ) {
    durationDays = Math.max(1, Math.min(14, Math.round(body.duration_days)));
  }

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : '';

  const { data, error } = await supabase
    .from('cycle_entries')
    .insert({
      user_id: user.id,
      start_date: startDate,
      duration_days: durationDays,
      notes,
    })
    .select('*')
    .single();

  if (error) {
    // Postgres unique-violation code (start_date already logged for this user).
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'an entry already exists for this start_date' },
        { status: 409 }
      );
    }
    console.error('[cycle] insert error', error);
    return NextResponse.json({ error: 'failed to save entry' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entry: data });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('cycle_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[cycle] delete error', error);
    return NextResponse.json({ error: 'failed to delete entry' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
