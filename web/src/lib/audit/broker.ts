/**
 * Outbound HTTP broker + audit ledger.
 *
 * Inspired by HELIX's PrivacyKit/OutboundBroker.swift. Every outbound network
 * call from Protocol that touches third-party data (Claude, Garmin, Whoop,
 * food APIs) flows through `brokeredFetch`. v1 logged to stdout only;
 * v2 persists to public.audit_ledger via the service-role client.
 *
 * Rules:
 *   1. Audit payloads must NEVER contain decrypted secrets (Authorization
 *      headers, refresh tokens, request bodies). Strip at the call site;
 *      brokeredFetch additionally redacts the URL query string.
 *   2. logAudit() persists best-effort: ledger insert failures are logged
 *      to stderr and swallowed. Audit must never break sync.
 */

import { getAdminClient } from '@/lib/supabase/admin';

export type AuditStatus = 'ok' | 'error' | 'retry' | 'skipped';

export interface AuditEntry {
  actor: string; // user_id, or 'system' for cron
  action: string; // 'claude.messages.create', 'sync.garmin', 'fetch.post', etc.
  target: string; // hostname or service identifier
  purpose: string; // 'briefing', 'chat', 'biometrics_sync'
  ts: string;
  // v2 extras — all optional so legacy callers stay valid.
  status?: AuditStatus;
  msElapsed?: number;
  rowsAffected?: number;
  errorMessage?: string;
  payload?: unknown;
}

/**
 * Persist one audit entry. Always logs to stdout; best-effort inserts into
 * audit_ledger via the service-role client. Async so callers may `await` to
 * guarantee the insert lands before lambda teardown — but legacy fire-and-
 * forget calls (existing chat/briefing routes) keep working unchanged.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  console.log('[audit]', JSON.stringify(entry));

  try {
    const supabase = getAdminClient();
    const isSystem = entry.actor === 'system';
    const userId = isSystem ? null : isUuid(entry.actor) ? entry.actor : null;

    await supabase.from('audit_ledger').insert({
      user_id: userId,
      ts: entry.ts,
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      purpose: entry.purpose,
      status: entry.status ?? 'ok',
      ms_elapsed: entry.msElapsed ?? null,
      rows_affected: entry.rowsAffected ?? null,
      error_message: entry.errorMessage ?? null,
      payload: entry.payload ?? null,
    });
  } catch (e) {
    console.error('[audit] persist failed', e);
  }
}

export interface BrokeredFetchOptions extends RequestInit {
  actor: string;
  purpose: string;
  action?: string; // defaults to `fetch.<method>`
}

/**
 * Wrap fetch() with audit + timing. Logs one ok/error row per call. Does not
 * retry — wrap with `withBackoff` in lib/sync/retry.ts to get retries; each
 * retry attempt becomes its own audit row tagged via `onAttempt`.
 *
 * Audit payload includes redacted URL + http_status, never headers/body.
 */
export async function brokeredFetch(
  url: string,
  opts: BrokeredFetchOptions
): Promise<Response> {
  const target = safeHostname(url);
  const method = (opts.method || 'GET').toUpperCase();
  const action = opts.action ?? `fetch.${method.toLowerCase()}`;
  const startedAt = Date.now();

  const init: RequestInit = { ...opts };
  delete (init as Record<string, unknown>).actor;
  delete (init as Record<string, unknown>).purpose;
  delete (init as Record<string, unknown>).action;

  let response: Response | undefined;
  let caught: unknown;
  try {
    response = await fetch(url, init);
  } catch (e) {
    caught = e;
  }
  const msElapsed = Date.now() - startedAt;

  if (caught) {
    await logAudit({
      actor: opts.actor,
      action,
      target,
      purpose: opts.purpose,
      ts: new Date().toISOString(),
      status: 'error',
      msElapsed,
      errorMessage: errorMessageOf(caught),
      payload: { url: redactUrl(url), method },
    });
    throw caught;
  }

  const res = response!;
  const status: AuditStatus = res.status >= 200 && res.status < 400 ? 'ok' : 'error';
  await logAudit({
    actor: opts.actor,
    action,
    target,
    purpose: opts.purpose,
    ts: new Date().toISOString(),
    status,
    msElapsed,
    errorMessage: status === 'error' ? `HTTP ${res.status}` : undefined,
    payload: { url: redactUrl(url), method, http_status: res.status },
  });
  return res;
}

// ---------- internals ----------

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 64);
  }
}

// Strip query + fragment — both can carry secrets (api_key=, etc).
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return safeHostname(url);
  }
}

function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
