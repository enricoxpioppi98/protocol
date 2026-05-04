import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/sync/history?source=<src>&days=<n>
 *
 * Returns the calling user's recent audit_ledger rows. RLS already scopes
 * the query to auth.uid(), but we use the user-session client (not the
 * service role) so the policy is enforced.
 *
 * Query params:
 *   - source: optional. Filters by `action LIKE 'sync.<source>%'`
 *             (e.g. ?source=garmin matches 'sync.garmin', 'sync.garmin.full').
 *   - days:   optional, default 7, max 90. Time window from now.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const source = searchParams.get('source');
  const daysRaw = searchParams.get('days');

  let days = 7;
  if (daysRaw !== null) {
    const parsed = Number.parseInt(daysRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: 'days must be a positive integer' },
        { status: 400 }
      );
    }
    days = Math.min(parsed, 90);
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('audit_ledger')
    .select(
      'id, ts, actor, action, target, purpose, status, ms_elapsed, rows_affected, error_message, payload'
    )
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(200);

  if (source) {
    // Whitelist: action prefixes are short alphanumeric + dots/dashes.
    // Reject anything else so we don't end up doing % LIKE injection games.
    if (!/^[a-z0-9._-]{1,32}$/i.test(source)) {
      return NextResponse.json(
        { error: 'invalid source' },
        { status: 400 }
      );
    }
    query = query.like('action', `sync.${source}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[api/sync/history] query failed', error);
    return NextResponse.json(
      { error: 'failed to load audit history' },
      { status: 500 }
    );
  }

  return NextResponse.json({ rows: data ?? [], days, source: source ?? null });
}
