import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/orchestrator';
import { ALL_SYNC_SOURCES, SOURCE_POLICY, type SyncSource } from '@/lib/sync/policy';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/sync/run
 *
 * Body: { sources?: SyncSource[], force?: boolean, days?: number }
 *
 * Runs the orchestrator for the calling user. With no body, defaults to all
 * connected sources for the user, 1 day, no force.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunBody {
  sources?: SyncSource[];
  force?: boolean;
  days?: number;
}

function isSyncSource(s: unknown): s is SyncSource {
  return typeof s === 'string' && s in SOURCE_POLICY;
}

async function connectedSources(userId: string): Promise<SyncSource[]> {
  const admin = getAdminClient();
  const [garmin, whoop] = await Promise.all([
    admin.from('garmin_credentials').select('user_id').eq('user_id', userId).maybeSingle(),
    admin.from('whoop_credentials').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  const out: SyncSource[] = [];
  if (garmin.data) out.push('garmin');
  if (whoop.data) out.push('whoop');
  return out;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as RunBody;

  let sources: SyncSource[];
  if (Array.isArray(body.sources) && body.sources.length > 0) {
    const filtered = body.sources.filter(isSyncSource);
    if (filtered.length === 0) {
      return NextResponse.json({ error: 'no valid sources' }, { status: 400 });
    }
    sources = filtered;
  } else {
    sources = await connectedSources(user.id);
    if (sources.length === 0) {
      // Fall back to the full list so the caller still sees per-source skip
      // results — the dashboard uses these to label cards.
      sources = ALL_SYNC_SOURCES.slice();
    }
  }

  const force = body.force === true;
  const daysRaw = typeof body.days === 'number' ? body.days : 1;
  const days = Math.max(1, Math.min(31, Math.floor(daysRaw)));

  const results = await runSync(user.id, sources, { force, days });
  return NextResponse.json({ results });
}
