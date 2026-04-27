/**
 * Outbound HTTP broker. Inspired by HELIX's PrivacyKit/OutboundBroker.swift.
 *
 * Every outbound network call from Protocol that touches third-party data
 * (Claude, Garmin, food APIs) should flow through `brokeredFetch`. v1 logs
 * to stdout; v2 will persist to a Supabase `audit_ledger` table.
 *
 * The architectural invariant — "all outbound bytes flow through the broker"
 * — is what makes a future privacy-mode toggle, rate-limit policy, or
 * regional egress allowlist a single change instead of a sweep.
 */

export interface AuditEntry {
  actor: string; // user_id, or 'system' for cron
  action: string; // 'claude.messages.create', 'garmin.today', etc.
  target: string; // hostname or service identifier
  purpose: string; // 'briefing', 'chat', 'biometrics_sync'
  ts: string;
}

export function logAudit(entry: AuditEntry): void {
  // v1: stdout. v2: also insert into public.audit_ledger.
  // eslint-disable-next-line no-console
  console.log('[audit]', JSON.stringify(entry));
}

export interface BrokeredFetchOptions extends RequestInit {
  actor: string;
  purpose: string;
}

/**
 * Wrap fetch with audit logging. Use for outbound calls to third-party services
 * (Garmin Railway service, food APIs). Claude SDK calls are audited inside the
 * Claude wrapper functions in `lib/claude/`.
 */
export async function brokeredFetch(
  url: string,
  opts: BrokeredFetchOptions
): Promise<Response> {
  const target = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  logAudit({
    actor: opts.actor,
    action: `fetch.${(opts.method || 'GET').toLowerCase()}`,
    target,
    purpose: opts.purpose,
    ts: new Date().toISOString(),
  });

  const { actor: _a, purpose: _p, ...init } = opts;
  return fetch(url, init);
}
