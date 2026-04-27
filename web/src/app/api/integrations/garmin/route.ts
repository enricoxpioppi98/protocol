import { NextResponse } from 'next/server';
import { encryptSecret } from '@/lib/crypto/aes';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/integrations/garmin
 * Body: { email, password }
 *
 * Encrypts the password with AES-256-GCM (GARMIN_ENC_KEY) and upserts the row.
 * Uses the service-role client so we don't accidentally rely on the row's
 * SELECT policy (there isn't one for authenticated users — by design).
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
    | { email?: string; password?: string }
    | null;
  if (!body?.email || !body.password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }

  let encrypted: string;
  try {
    encrypted = encryptSecret(body.password);
  } catch (err) {
    console.error('[integrations/garmin] encrypt failed', err);
    return NextResponse.json({ error: 'server crypto not configured' }, { status: 500 });
  }

  const admin = getAdminClient();
  const { error } = await admin.from('garmin_credentials').upsert(
    {
      user_id: user.id,
      email: body.email,
      password_encrypted: encrypted,
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    console.error('[integrations/garmin] upsert error', error);
    return NextResponse.json({ error: 'failed to save credentials' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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
    .from('garmin_credentials')
    .delete()
    .eq('user_id', user.id);
  if (error) {
    console.error('[integrations/garmin] delete error', error);
    return NextResponse.json({ error: 'failed to delete credentials' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/integrations/garmin — returns whether the user has creds (no plaintext).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('garmin_credentials')
    .select('email')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
  return NextResponse.json({ connected: !!data, email: data?.email ?? null });
}
