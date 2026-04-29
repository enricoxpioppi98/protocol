import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import type { BiometricsSource } from '@/lib/types/models';

/**
 * POST /api/biometrics/apple-watch
 *
 * Webhook called by an iOS Shortcut on the user's iPhone. The Shortcut sends:
 *   Authorization: Bearer <raw_token>     (issued at provisioning time)
 *   Content-Type:  application/json
 *   <JSON body, see schema below>
 *
 * We SHA-256 the bearer, look up `apple_watch_tokens.token_hash`, and upsert
 * `biometrics_daily` for that user with source='apple_watch'.
 *
 * Status codes:
 *   200  ok
 *   400  malformed body / missing date
 *   401  missing or invalid bearer token
 *   413  body > 64 KB
 *   500  server error
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB — payload is ~14 small numeric fields

interface AppleWatchPayload {
  date?: string;
  sleep_score?: number | null;
  sleep_duration_minutes?: number | null;
  hrv_ms?: number | null;
  resting_hr?: number | null;
  stress_avg?: number | null;
  total_steps?: number | null;
  active_minutes?: number | null;
  vigorous_minutes?: number | null;
  active_kcal_burned?: number | null;
  deep_sleep_minutes?: number | null;
  rem_sleep_minutes?: number | null;
  min_hr?: number | null;
  max_hr?: number | null;
  vo2max?: number | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function POST(req: Request) {
  // Bearer token from Authorization header.
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }
  const rawToken = match[1].trim();
  if (!rawToken) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }

  // Read the raw body so we can enforce a hard size cap before JSON.parse.
  // Shortcuts has a 'Get Contents of URL' action with no Content-Length
  // guarantee, so we trust the actual byte count.
  let bodyText: string;
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
    bodyText = new TextDecoder().decode(buf);
  } catch (err) {
    console.error('[biometrics/apple-watch] body read failed', err);
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  let payload: AppleWatchPayload;
  try {
    payload = JSON.parse(bodyText) as AppleWatchPayload;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  // Date handling: the Shortcut produces a local-date string (YYYY-MM-DD). We
  // accept anything matching that pattern and otherwise fall back to UTC today
  // — this tolerates Shortcut clock skew or a user whose phone date format got
  // shifted. We do NOT silently rewrite a valid-looking-but-future date; the
  // dashboard ranges queries by date, so a user on a plane crossing the
  // dateline still gets their latest reading bucketed at *their* "today".
  const date =
    typeof payload.date === 'string' && ISO_DATE_RE.test(payload.date)
      ? payload.date
      : new Date().toISOString().slice(0, 10);

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const admin = getAdminClient();

  const { data: row, error: lookupErr } = await admin
    .from('apple_watch_tokens')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (lookupErr) {
    console.error('[biometrics/apple-watch] token lookup error', lookupErr);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }
  const userId = row.user_id as string;

  const fetchedAt = new Date().toISOString();
  const upsertPayload = {
    user_id: userId,
    date,
    sleep_score: numOrNull(payload.sleep_score),
    sleep_duration_minutes: numOrNull(payload.sleep_duration_minutes),
    hrv_ms: numOrNull(payload.hrv_ms),
    resting_hr: numOrNull(payload.resting_hr),
    stress_avg: numOrNull(payload.stress_avg),
    total_steps: numOrNull(payload.total_steps),
    active_minutes: numOrNull(payload.active_minutes),
    vigorous_minutes: numOrNull(payload.vigorous_minutes),
    active_kcal_burned: numOrNull(payload.active_kcal_burned),
    deep_sleep_minutes: numOrNull(payload.deep_sleep_minutes),
    rem_sleep_minutes: numOrNull(payload.rem_sleep_minutes),
    min_hr: numOrNull(payload.min_hr),
    max_hr: numOrNull(payload.max_hr),
    vo2max: numOrNull(payload.vo2max),
    // Track V (migration 011) extends the BiometricsSource enum to include
    // 'apple_watch'. Until that lands in this branch's models.ts we cast.
    source: 'apple_watch' as unknown as BiometricsSource,
    raw: payload as unknown,
    fetched_at: fetchedAt,
  };

  const { error: upsertErr } = await admin
    .from('biometrics_daily')
    .upsert(upsertPayload, { onConflict: 'user_id,date' });
  if (upsertErr) {
    console.error('[biometrics/apple-watch] upsert error', upsertErr);
    return NextResponse.json(
      { error: 'failed to persist biometrics' },
      { status: 500 }
    );
  }

  // Touch last_used_at so the settings page can show "Last sync: 2 minutes ago".
  // Best-effort — we don't fail the webhook if this fails.
  await admin
    .from('apple_watch_tokens')
    .update({ last_used_at: fetchedAt })
    .eq('user_id', userId);

  return NextResponse.json({ ok: true });
}
