'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, AlertTriangle, ChevronLeft, RefreshCw, Trash2 } from 'lucide-react';

interface WhoopStatus {
  connected: boolean;
  whoop_user_id: string | null;
  last_synced_at: string | null;
  missing?: string[];
}

function formatTime(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function WhoopIntegrationPage() {
  // useSearchParams forces this subtree onto the client during static
  // prerender, so it must live inside a Suspense boundary.
  return (
    <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
      <WhoopPageInner />
    </Suspense>
  );
}

function WhoopPageInner() {
  const params = useSearchParams();
  const justConnected = params.get('connected') === '1';
  const oauthError = params.get('error');

  const [status, setStatus] = useState<WhoopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/whoop');
      // 503 means env vars unset — the body still has a valid `missing[]`.
      const body = (await res.json()) as WhoopStatus;
      setStatus(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (justConnected) {
      setMessage('Whoop connected. Run a sync to backfill recent days.');
    } else if (oauthError) {
      setError(`OAuth error: ${oauthError}`);
    }
  }, [justConnected, oauthError]);

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/biometrics/sync-whoop?days=7', { method: 'POST' });
      const body = (await res.json()) as { rows?: unknown[]; error?: string };
      if (!res.ok) {
        setError(body.error ?? `sync failed (${res.status})`);
      } else {
        const n = body.rows?.length ?? 0;
        setMessage(`Synced ${n} day${n === 1 ? '' : 's'}.`);
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Whoop? Existing biometrics rows are kept; we just forget your tokens.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/integrations/whoop', { method: 'DELETE' });
      await refresh();
      setMessage('Whoop disconnected.');
    } finally {
      setBusy(false);
    }
  }

  const missing = status?.missing ?? [];
  const notConfigured = missing.length > 0;

  return (
    <div className="space-y-5">
      <Link
        href="/settings/integrations"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        Integrations
      </Link>

      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="eyebrow text-accent">Recovery wearable</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          Whoop
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Sign in with Whoop to pull recovery, strain, and sleep into your
          daily biometrics. Tokens are stored encrypted; you can disconnect at
          any time.
        </p>
      </header>

      {message ? (
        <div className="rounded-xl border border-fiber/30 bg-fiber-light px-3 py-2 text-xs text-fiber">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <section className="glass rounded-2xl p-5">
          <p className="text-sm text-muted">Loading…</p>
        </section>
      ) : notConfigured ? (
        <section className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-2 text-warning">
              <AlertTriangle size={18} />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-xl text-foreground">Configuration required</h2>
              <p className="mt-0.5 text-xs text-muted">
                The deployer of this Protocol instance hasn&rsquo;t wired up Whoop OAuth
                yet. Register an app at{' '}
                <a
                  href="https://developer.whoop.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline"
                >
                  developer.whoop.com
                </a>{' '}
                and set these environment variables:
              </p>
            </div>
          </div>
          <ul className="space-y-1 font-mono text-xs text-foreground">
            {missing.map((k) => (
              <li key={k} className="rounded-lg border border-border bg-glass-1 px-3 py-1.5">
                {k}
              </li>
            ))}
          </ul>
        </section>
      ) : status?.connected ? (
        <section className="glass rounded-2xl p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl border border-border bg-glass-2 p-2 text-accent">
              <Activity size={18} />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-xl text-foreground">Connected</h2>
              <p className="mt-0.5 text-xs text-muted">
                Recovery, strain, and sleep flow into <code>biometrics_daily</code>{' '}
                with <code>source=&apos;whoop&apos;</code>.
              </p>
            </div>
            <span className="rounded-full border border-fiber/30 bg-fiber-light px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fiber">
              · connected
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-glass-1 p-3 text-sm">
              <div className="eyebrow">Whoop user</div>
              <div className="mt-1 font-mono text-foreground">
                {status.whoop_user_id ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-glass-1 p-3 text-sm">
              <div className="eyebrow">Last synced</div>
              <div className="mt-1 font-mono text-foreground">
                {formatTime(status.last_synced_at)}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={syncNow}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              {busy ? 'Syncing…' : 'Sync now (last 7 days)'}
            </button>
            <button
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
            >
              <Trash2 size={14} /> Disconnect
            </button>
          </div>
        </section>
      ) : (
        <section className="glass rounded-2xl p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl border border-border bg-glass-2 p-2 text-accent">
              <Activity size={18} />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-xl text-foreground">Not connected</h2>
              <p className="mt-0.5 text-xs text-muted">
                Whoop uses OAuth — you&rsquo;ll be sent to Whoop&rsquo;s site to
                approve read-only access to recovery, cycles, sleep, and profile.
              </p>
            </div>
          </div>

          <a
            href="/api/integrations/whoop/authorize"
            className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent"
          >
            Sign in with Whoop
          </a>

          <p className="mt-3 text-[11px] leading-snug text-muted">
            Tokens are AES-256-GCM encrypted at rest. You can disconnect at any time.
          </p>
        </section>
      )}
    </div>
  );
}
