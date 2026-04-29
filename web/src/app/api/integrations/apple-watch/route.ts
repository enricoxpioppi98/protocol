import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * GET    /api/integrations/apple-watch — { connected, last_used_at, endpoint_url }
 * DELETE /api/integrations/apple-watch — removes the token row.
 *
 * Provisioning (and rotation) lives at /api/integrations/apple-watch/provision.
 * GET intentionally returns no token material — the raw token is shown exactly
 * once, at provision time.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function absoluteEndpointUrl(req: Request): string {
  const url = new URL(req.url);
  const proto =
    req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  return `${proto}://${host}/api/biometrics/apple-watch`;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('apple_watch_tokens')
    .select('last_used_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('[integrations/apple-watch GET] lookup error', error);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }

  return NextResponse.json({
    connected: !!data,
    last_used_at: (data?.last_used_at as string | null) ?? null,
    endpoint_url: absoluteEndpointUrl(req),
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
    .from('apple_watch_tokens')
    .delete()
    .eq('user_id', user.id);
  if (error) {
    console.error('[integrations/apple-watch DELETE] delete error', error);
    return NextResponse.json({ error: 'failed to delete' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
