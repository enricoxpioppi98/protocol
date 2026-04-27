import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM helpers for encrypting Garmin passwords at rest.
 *
 * Format on disk: "<iv-base64>.<ciphertext-base64>.<tag-base64>"
 *
 * Server-only. The key (GARMIN_ENC_KEY) is a 32-byte base64 string. Generate
 * with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
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

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${enc.toString('base64')}.${tag.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivB64, encB64, tagB64] = payload.split('.');
  if (!ivB64 || !encB64 || !tagB64) {
    throw new Error('encrypted payload malformed');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}
