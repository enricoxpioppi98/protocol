import { NextResponse } from 'next/server';
import { triggerAutoBackfill } from '@/lib/sync/backfill';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/sync/auto-backfill
 *
 * Auth: standard Supabase session. No CRON_SECRET — this is user-triggered
 * (the dashboard's AutoBackfillTrigger component fires it on mount). The
 * 30-min cooldown gate inside `triggerAutoBackfill` prevents abuse.
 *
 * Returns:
 *   { filled: { [source]: number }, errors: string[] }
 *
 * Notable response shapes the dashboard checks:
 *   - errors: ['cooldown']    → stay silent (gate tripped)
 *   - errors: ['no_sources']  → user has nothing connected; show nothing
 *   - filled has totals > 0   → toast/banner per non-zero source
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const result = await triggerAutoBackfill(user.id);
  return NextResponse.json(result);
}
