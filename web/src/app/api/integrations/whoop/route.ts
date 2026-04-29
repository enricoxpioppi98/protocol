import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { readWhoopEnv } from '@/lib/whoop/client';

/**
 * GET    /api/integrations/whoop — { connected, whoop_user_id, last_synced_at, missing? }
 * DELETE /api/integrations/whoop — wipes the user's whoop_credentials row.
 *
 * The GET handler also surfaces an env `missing[]` array so the settings page
 * can render a "configuration required" card if the deployer never wired up
 * Whoop OAuth secrets. (Returning 200 + missing instead of 503 here so the
 * UI doesn't have to special-case status codes for a configuration signal.)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const env = readWhoopEnv();
  if (!env.ok) {
    return NextResponse.json(
      { connected: false, missing: env.missing },
      { status: 503 }
    );
  }

  const admin = getAdminClient();
  const { data: creds } = await admin
    .from('whoop_credentials')
    .select('whoop_user_id, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  // Most recent whoop-sourced biometrics row tells the UI when we last
  // pulled Whoop data, independent of when the credentials were rotated.
  let lastSyncedAt: string | null = null;
  if (creds) {
    const { data: lastRow } = await admin
      .from('biometrics_daily')
      .select('fetched_at')
      .eq('user_id', user.id)
      .eq('source', 'whoop')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastSyncedAt = (lastRow?.fetched_at as string | null) ?? null;
  }

  return NextResponse.json({
    connected: !!creds,
    whoop_user_id: (creds?.whoop_user_id as string | null) ?? null,
    last_synced_at: lastSyncedAt,
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from('whoop_credentials')
    .delete()
    .eq('user_id', user.id);
  if (error) {
    console.error('[integrations/whoop] delete error', error);
    return NextResponse.json({ error: 'failed to delete credentials' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
