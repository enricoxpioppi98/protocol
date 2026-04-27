import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PUT /api/profile/pinned-metrics
 * Body: { pinned: string[] }
 *
 * Updates the signed-in user's `user_profile.pinned_metrics` allow-list. The
 * BiometricsCard filters its `AVAILABLE_METRICS` catalog by this list and
 * renders them in pin order.
 *
 * No server-side validation against the catalog: identifiers are intentionally
 * just strings so adding new metrics later (Track H is extending
 * BiometricsDaily) doesn't require code changes here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PutBody {
  pinned?: unknown;
}

function sanitizePinned(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const pinned = sanitizePinned(body.pinned);

  const { error } = await supabase
    .from('user_profile')
    .update({ pinned_metrics: pinned })
    .eq('user_id', user.id);

  if (error) {
    console.error('[pinned-metrics] update error', error);
    return NextResponse.json(
      { error: 'failed to save pinned metrics' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, pinned });
}
