import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/integrations/apple-watch/provision
 *
 * Generates a fresh 32-byte URL-safe bearer token for the signed-in user,
 * stores ONLY its SHA-256 hash in `apple_watch_tokens` (upsert), and returns
 * the raw token + absolute webhook URL exactly once. Subsequent calls rotate
 * the token — the previous one stops working immediately.
 *
 * The user pastes the raw token into an iOS Shortcut; the Shortcut sends
 * `Authorization: Bearer <raw>` to /api/biometrics/apple-watch.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function absoluteEndpointUrl(req: Request): string {
  // Prefer the forwarded host (Vercel / proxied prod) and fall back to the
  // request URL's origin (local dev). We hand the user the URL their phone
  // will hit — never a relative path.
  const url = new URL(req.url);
  const proto =
    req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  return `${proto}://${host}/api/biometrics/apple-watch`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const admin = getAdminClient();
  const { error } = await admin.from('apple_watch_tokens').upsert(
    {
      user_id: user.id,
      token_hash: tokenHash,
      // Reset last_used_at on rotation so the settings UI doesn't show a stale
      // sync time against the new token.
      last_used_at: null,
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    console.error('[integrations/apple-watch/provision] upsert error', error);
    return NextResponse.json(
      { error: 'failed to provision token' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    token: rawToken,
    endpoint_url: absoluteEndpointUrl(req),
  });
}
