'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Garmin email/password capture, lifted from the legacy integrations page so
 * the new dashboard can keep the existing connect / disconnect UX inline.
 *
 * - GET  /api/integrations/garmin → { connected, email }
 * - POST /api/integrations/garmin → upserts encrypted creds
 * - DELETE                       → wipes them
 *
 * The component reads its own initial connection state on mount so the parent
 * server component doesn't need to thread the email through (it's also user
 * data we'd rather not duplicate-fetch).
 */
export function GarminConnectForm({ onChange }: { onChange?: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/integrations/garmin');
      const data = await res.json().catch(() => ({}));
      setConnected(!!data?.connected);
      setSavedEmail(data?.email ?? null);
    } catch {
      setConnected(false);
      setSavedEmail(null);
    }
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
        onChange?.();
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
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  if (connected === null) {
    // Initial fetch in-flight; render a quiet placeholder so layout stays stable.
    return (
      <div className="rounded-xl border border-border bg-glass-1 p-3 text-xs text-muted">
        Loading Garmin status…
      </div>
    );
  }

  if (connected) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-glass-1 p-3 text-sm">
          <div className="eyebrow">Account</div>
          <div className="mt-1 font-mono text-foreground">
            {savedEmail ?? '—'}
          </div>
        </div>
        <button
          onClick={disconnect}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
        >
          <Trash2 size={12} /> Disconnect
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <div>
        <label className="eyebrow">Email</label>
        <input
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
        />
      </div>
      <div>
        <label className="eyebrow">Password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Encrypted (AES-256-GCM) before storage. Used only to fetch your
          biometrics from Garmin Connect — never shared.
        </p>
      </div>
      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Connect Garmin'}
      </button>
    </form>
  );
}
