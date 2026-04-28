import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { GlucoseContext } from '@/lib/types/models';

/**
 * /api/glucose
 *
 *   POST   { recorded_at, mg_dl, context?, notes? } → insert one reading.
 *   DELETE ?id=<uuid>                                → soft-delete one row (hard delete; RLS scopes to user).
 *
 * The reading is recorded against the authenticated user. Source defaults to
 * `manual`; future CGM API integrations will set their own source on insert.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CONTEXTS = new Set<GlucoseContext>([
  'fasting',
  'pre_meal',
  'post_meal',
  'overnight',
  'workout',
  'random',
]);

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
        recorded_at?: unknown;
        mg_dl?: unknown;
        context?: unknown;
        notes?: unknown;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: 'expected JSON body' }, { status: 400 });
  }

  const recordedAt =
    typeof body.recorded_at === 'string' && body.recorded_at.trim().length > 0
      ? body.recorded_at
      : null;
  const mgDl =
    typeof body.mg_dl === 'number' && Number.isFinite(body.mg_dl)
      ? Math.round(body.mg_dl)
      : null;

  if (!recordedAt) {
    return NextResponse.json({ error: 'recorded_at required (ISO timestamp)' }, { status: 400 });
  }
  if (mgDl === null || mgDl <= 0 || mgDl >= 1000) {
    return NextResponse.json(
      { error: 'mg_dl must be a number in (0, 1000)' },
      { status: 400 }
    );
  }

  // `context` is optional; only persist when it's a recognized tag so the DB
  // check constraint never trips on garbage values.
  let context: GlucoseContext | null = null;
  if (typeof body.context === 'string' && VALID_CONTEXTS.has(body.context as GlucoseContext)) {
    context = body.context as GlucoseContext;
  }

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : '';

  const { data, error } = await supabase
    .from('glucose_readings')
    .insert({
      user_id: user.id,
      recorded_at: recordedAt,
      mg_dl: mgDl,
      context,
      notes,
      source: 'manual',
    })
    .select('*')
    .single();

  if (error) {
    console.error('[glucose] insert error', error);
    return NextResponse.json({ error: 'failed to save reading' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reading: data });
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
    .from('glucose_readings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[glucose] delete error', error);
    return NextResponse.json({ error: 'failed to delete reading' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
