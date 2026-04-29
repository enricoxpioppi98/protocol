import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyState } from '@/lib/oauth/state';
import {
  exchangeCodeForTokens,
  persistTokens,
  readWhoopEnv,
  WHOOP_API_BASE,
} from '@/lib/whoop/client';
import { brokeredFetch } from '@/lib/audit/broker';

/**
 * GET /api/integrations/whoop/callback?code=...&state=...
 *
 * The redirect target Whoop sends the user back to after consent. We:
 *   1. validate the `state` query param against the signed cookie,
 *   2. exchange the `code` for tokens at Whoop's token endpoint,
 *   3. fetch the Whoop user id (best-effort — non-fatal on failure),
 *   4. AES-256-GCM encrypt both tokens via lib/crypto/aes.ts (key is
 *      GARMIN_ENC_KEY, reused across integrations — see code comment in
 *      lib/oauth/state.ts),
 *   5. upsert the row using the service-role client (RLS bypass — the table
 *      has no SELECT policy for authenticated clients).
 *
 * On success we 302 to /settings/integrations/whoop?connected=1; on any
 * failure we 302 to /settings/integrations/whoop?error=... so the user lands
 * on a real page rather than a JSON blob.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'whoop_oauth_state';
const SETTINGS_PATH = '/settings/integrations/whoop';

function redirectWithError(req: Request, code: string): NextResponse {
  const url = new URL(SETTINGS_PATH, req.url);
  url.searchParams.set('error', code);
  const res = NextResponse.redirect(url, { status: 302 });
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return redirectWithError(req, oauthError);
  }
  if (!code || !stateParam) {
    return redirectWithError(req, 'missing_code_or_state');
  }

  // CSRF check: cookie state must match query state, AND the signature must
  // verify against THIS user's id.
  const cookieState = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.split('=')[1];

  if (!cookieState || cookieState !== stateParam) {
    return redirectWithError(req, 'state_mismatch');
  }
  if (!verifyState(stateParam, user.id)) {
    return redirectWithError(req, 'state_invalid');
  }

  const env = readWhoopEnv();
  if (!env.ok || !env.config) {
    return redirectWithError(req, 'not_configured');
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, env.config, user.id);
  } catch (err) {
    console.error('[whoop/callback] token exchange failed', err);
    return redirectWithError(req, 'token_exchange_failed');
  }

  // Fetch the Whoop user id so the settings UI can show "connected as <id>".
  // Non-fatal: we already have the tokens, so connection succeeds either way.
  let whoopUserId: string | null = null;
  try {
    const profileRes = await brokeredFetch(`${WHOOP_API_BASE}/v1/user/profile/basic`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
      actor: user.id,
      purpose: 'whoop_profile',
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as { user_id?: number | string };
      if (profile.user_id !== undefined && profile.user_id !== null) {
        whoopUserId = String(profile.user_id);
      }
    }
  } catch (err) {
    console.warn('[whoop/callback] profile lookup failed (non-fatal)', err);
  }

  try {
    await persistTokens({ userId: user.id, whoopUserId, tokens });
  } catch (err) {
    console.error('[whoop/callback] persist failed', err);
    return redirectWithError(req, 'persist_failed');
  }

  const successUrl = new URL(SETTINGS_PATH, req.url);
  successUrl.searchParams.set('connected', '1');
  const res = NextResponse.redirect(successUrl, { status: 302 });
  res.cookies.delete(STATE_COOKIE);
  return res;
}
