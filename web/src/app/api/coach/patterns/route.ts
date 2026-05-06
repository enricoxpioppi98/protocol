import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/coach/patterns
 *
 * Returns the calling user's surviving correlation findings, ordered by
 * |correlation| desc, capped at 10. RLS on `coach_patterns` already scopes
 * the read to the authenticated user — we still call `getUser()` so an
 * unauthenticated request gets a clean 401 rather than an empty array.
 *
 * Track 26 will consume this from the dashboard. Keep the shape stable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOP_N = 10;

interface CoachPatternRow {
  id: number;
  pattern_kind: string;
  finding_text: string;
  metric_a: string;
  metric_b: string;
  correlation: number;
  p_value: number | null;
  sample_size: number;
  payload: Record<string, unknown>;
  computed_at: string;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Postgres can't ORDER BY abs(correlation) through PostgREST without a
  // computed column or a view, so we fetch a generous slice and re-sort in
  // JS. With one row per pattern_kind (max ~10 patterns) the slice is tiny.
  const { data, error } = await supabase
    .from('coach_patterns')
    .select(
      'id, pattern_kind, finding_text, metric_a, metric_b, correlation, p_value, sample_size, payload, computed_at',
    )
    .eq('user_id', user.id)
    .limit(50);

  if (error) {
    console.error('[coach/patterns] read error', error);
    return NextResponse.json({ error: 'failed to read patterns' }, { status: 500 });
  }

  const rows = (data ?? []) as CoachPatternRow[];
  rows.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return NextResponse.json({ patterns: rows.slice(0, TOP_N) });
}
