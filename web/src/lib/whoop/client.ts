import { brokeredFetch } from '@/lib/audit/broker';
import { decryptSecret, encryptSecret } from '@/lib/crypto/aes';
import { getAdminClient } from '@/lib/supabase/admin';
import type { WhoopCredentialsRow } from '@/lib/types/models';

/**
 * Whoop API client helpers. All requests go through `brokeredFetch` so the
 * outbound bytes are audit-logged.
 *
 * Whoop's OAuth uses the standard authorization-code grant. Access tokens are
 * short-lived (~1h); refresh tokens rotate on each refresh and Whoop replies
 * with a fresh refresh_token. We persist the rotated tokens after every
 * refresh so we don't re-use a revoked refresh_token.
 */

export const WHOOP_AUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';

/**
 * Scopes we request on initial connect. `offline` is required to receive a
 * refresh_token; the rest are read-only access to the data we map to
 * biometrics_daily.
 */
export const WHOOP_SCOPES = [
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:profile',
  'offline',
];

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export interface WhoopEnvConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface WhoopEnvResult {
  ok: boolean;
  config: WhoopEnvConfig | null;
  missing: string[];
}

/**
 * Read Whoop OAuth env vars. Returns the missing keys so the caller can emit
 * a useful 503 / configuration-required UI without leaking which secret is
 * actually unset.
 */
export function readWhoopEnv(): WhoopEnvResult {
  const clientId = process.env.WHOOP_CLIENT_ID ?? '';
  const clientSecret = process.env.WHOOP_CLIENT_SECRET ?? '';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const redirectUri =
    process.env.WHOOP_REDIRECT_URI ||
    (baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/integrations/whoop/callback` : '');

  const missing: string[] = [];
  if (!clientId) missing.push('WHOOP_CLIENT_ID');
  if (!clientSecret) missing.push('WHOOP_CLIENT_SECRET');
  if (!redirectUri) missing.push('WHOOP_REDIRECT_URI');

  if (missing.length > 0) {
    return { ok: false, config: null, missing };
  }
  return {
    ok: true,
    config: { clientId, clientSecret, redirectUri },
    missing: [],
  };
}

/**
 * Exchange an authorization `code` for tokens (the OAuth callback step).
 */
export async function exchangeCodeForTokens(
  code: string,
  cfg: WhoopEnvConfig,
  actor: string
): Promise<WhoopTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await brokeredFetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    actor,
    purpose: 'whoop_oauth',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`whoop token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as WhoopTokenResponse;
}

/**
 * Use a refresh_token to mint a new access_token. Whoop rotates the
 * refresh_token, so the caller MUST persist `tok.refresh_token`.
 */
export async function refreshTokens(
  refreshToken: string,
  cfg: WhoopEnvConfig,
  actor: string
): Promise<WhoopTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: WHOOP_SCOPES.join(' '),
  });
  const res = await brokeredFetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    actor,
    purpose: 'whoop_token_refresh',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`whoop token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as WhoopTokenResponse;
}

/**
 * Persist a token response into `whoop_credentials`. Encrypts the refresh
 * and access tokens. `whoopUserId` is optional — only set on initial connect.
 */
export async function persistTokens(params: {
  userId: string;
  whoopUserId?: string | null;
  tokens: WhoopTokenResponse;
}): Promise<void> {
  const admin = getAdminClient();
  const refreshEnc = encryptSecret(params.tokens.refresh_token);
  const accessEnc = encryptSecret(params.tokens.access_token);
  const expiresAt = new Date(
    Date.now() + Math.max(60, params.tokens.expires_in - 60) * 1000
  ).toISOString();
  const scopes = (params.tokens.scope ?? WHOOP_SCOPES.join(' '))
    .split(/[\s,]+/)
    .filter(Boolean);

  type WhoopCredsUpsert = Pick<
    WhoopCredentialsRow,
    | 'user_id'
    | 'refresh_token_encrypted'
    | 'access_token_encrypted'
    | 'access_token_expires_at'
    | 'scopes'
  > & { whoop_user_id?: string | null };

  const row: WhoopCredsUpsert = {
    user_id: params.userId,
    refresh_token_encrypted: refreshEnc,
    access_token_encrypted: accessEnc,
    access_token_expires_at: expiresAt,
    scopes,
  };
  if (params.whoopUserId !== undefined) {
    row.whoop_user_id = params.whoopUserId;
  }

  const { error } = await admin
    .from('whoop_credentials')
    .upsert(row, { onConflict: 'user_id' });
  if (error) {
    throw new Error(`failed to persist whoop credentials: ${error.message}`);
  }
}

/**
 * Return a usable access token for the given user. Refreshes (and persists)
 * if the cached one is missing or within 60s of expiry.
 */
export async function getAccessToken(
  userId: string,
  cfg: WhoopEnvConfig
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('whoop_credentials')
    .select(
      'refresh_token_encrypted, access_token_encrypted, access_token_expires_at'
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    throw new Error('no whoop credentials on file');
  }

  const expiresAt = data.access_token_expires_at as string | null;
  const stillFresh =
    !!expiresAt &&
    !!data.access_token_encrypted &&
    new Date(expiresAt).getTime() - Date.now() > 60_000;
  if (stillFresh) {
    return decryptSecret(data.access_token_encrypted as string);
  }

  const refreshToken = decryptSecret(data.refresh_token_encrypted as string);
  const tok = await refreshTokens(refreshToken, cfg, userId);
  await persistTokens({ userId, tokens: tok });
  return tok.access_token;
}
