import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * OAuth state-token helpers.
 *
 * Used by the Whoop OAuth flow (`/api/integrations/whoop/authorize` and
 * `/callback`) to defeat CSRF on the redirect leg. The state token is a
 * random 16-byte nonce concatenated with an HMAC-SHA256 signature over the
 * nonce + the user id, base64url-encoded. The same key (GARMIN_ENC_KEY —
 * the only AES key today; reused so we don't need a second secret) seeds
 * the HMAC. This isn't AES, but the key bytes are appropriate: 32 random
 * bytes used as an HMAC key.
 *
 * The user id is bound into the signature so a state token issued for one
 * user can't be replayed by another browser.
 */

function getKey(): Buffer {
  const b64 = process.env.GARMIN_ENC_KEY;
  if (!b64) throw new Error('GARMIN_ENC_KEY is not set');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) {
    throw new Error(`GARMIN_ENC_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signState(userId: string): string {
  const nonce = randomBytes(16);
  const mac = createHmac('sha256', getKey())
    .update(nonce)
    .update('|')
    .update(userId)
    .digest();
  return `${b64url(nonce)}.${b64url(mac)}`;
}

export function verifyState(token: string, userId: string): boolean {
  const [nonceB64, macB64] = token.split('.');
  if (!nonceB64 || !macB64) return false;
  let nonce: Buffer;
  let mac: Buffer;
  try {
    nonce = fromB64url(nonceB64);
    mac = fromB64url(macB64);
  } catch {
    return false;
  }
  const expected = createHmac('sha256', getKey())
    .update(nonce)
    .update('|')
    .update(userId)
    .digest();
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(mac, expected);
}
