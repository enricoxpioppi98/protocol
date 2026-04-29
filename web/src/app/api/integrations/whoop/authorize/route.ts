import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signState } from '@/lib/oauth/state';
import { readWhoopEnv, WHOOP_AUTH_BASE, WHOOP_SCOPES } from '@/lib/whoop/client';

/**
 * GET /api/integrations/whoop/authorize
 *
 * Kicks off the Whoop OAuth authorization-code flow:
 *   1. mints a CSRF state token signed with GARMIN_ENC_KEY (HMAC-SHA256, bound
 *      to the user id so it can't be replayed cross-account),
 *   2. drops it in a short-lived (5 min) httpOnly cookie,
 *   3. 302s the browser to Whoop's hosted consent screen.
 *
 * The matching `/callback` route validates both the cookie AND the `state`
 * query param before exchanging the code.
 *
 * If the Whoop env vars aren't set we return 503 with a `missing[]` array so
 * the settings UI can render a "configuration required" card without leaking
 * which specific secret is unset.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'whoop_oauth_state';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const env = readWhoopEnv();
  if (!env.ok || !env.config) {
    return NextResponse.json(
      { error: 'whoop integration not configured', missing: env.missing },
      { status: 503 }
    );
  }

  const state = signState(user.id);
  const params = new URLSearchParams({
    client_id: env.config.clientId,
    redirect_uri: env.config.redirectUri,
    response_type: 'code',
    scope: WHOOP_SCOPES.join(' '),
    state,
  });
  const authorizeUrl = `${WHOOP_AUTH_BASE}?${params.toString()}`;

  const res = NextResponse.redirect(authorizeUrl, { status: 302 });
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/whoop',
    maxAge: 5 * 60,
  });
  return res;
}
