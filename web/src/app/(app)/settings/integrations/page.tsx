'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Watch, Trash2 } from 'lucide-react';

export default function IntegrationsPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/integrations/garmin');
    const data = await res.json();
    setConnected(!!data?.connected);
    setSavedEmail(data?.email ?? null);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Email and password required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/garmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'failed to save');
      } else {
        setEmail('');
        setPassword('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Remove Garmin connection?')) return;
    setBusy(true);
    try {
      await fetch('/api/integrations/garmin', { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Settings
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Connect external data sources so Protocol can read your overnight
          biometrics. Stored encrypted; you can disconnect at any time.
        </p>
      </header>

      <section className="rounded-2xl bg-card p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-xl bg-accent-light p-2 text-accent">
            <Watch size={20} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">Garmin Connect</h2>
            <p className="text-xs text-muted">
              Pulls sleep score, HRV, resting HR, stress, training load.
            </p>
          </div>
          {connected ? (
            <span className="rounded-full bg-fiber-light px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fiber">
              connected
            </span>
          ) : null}
        </div>

        {connected ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-card-hover p-3 text-sm">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                account
              </div>
              <div className="font-mono text-foreground">{savedEmail}</div>
            </div>
            <button
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
            >
              <Trash2 size={14} /> Disconnect
            </button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={save}>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted">
                Email
              </label>
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground outline-none ring-1 ring-border focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted">
                Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground outline-none ring-1 ring-border focus:ring-accent"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-muted">
                Encrypted (AES-256-GCM) before storage. Used only to fetch your
                biometrics from Garmin Connect — never shared.
              </p>
            </div>
            {error ? (
              <div className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Connect Garmin'}
            </button>
          </form>
        )}
      </section>

      <section className="rounded-2xl bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">
          No Garmin? No problem.
        </h2>
        <p className="mt-1 text-sm text-muted">
          You can also enter sleep / HRV / RHR / stress manually each morning
          from the dashboard. The coach uses whatever you give it.
        </p>
      </section>
    </div>
  );
}
