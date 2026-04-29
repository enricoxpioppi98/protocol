'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Smartphone,
  Trash2,
  Copy,
  RefreshCcw,
  Check,
  X,
} from 'lucide-react';

interface StatusResponse {
  connected: boolean;
  last_used_at: string | null;
  endpoint_url: string;
}

interface ProvisionResponse {
  token: string;
  endpoint_url: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'never';
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

const SETUP_STEPS: { n: string; body: React.ReactNode }[] = [
  { n: '01', body: <>Open <span className="font-mono">Shortcuts</span> on iPhone.</> },
  { n: '02', body: <>Tap <span className="font-mono">+</span> to create a new shortcut.</> },
  {
    n: '03',
    body: (
      <>
        Add these actions in order:
        <ul className="mt-2 space-y-1 text-muted">
          <li>
            <span className="font-mono">Get Health Sample</span> — Sleep
            Analysis, last 24 hours
          </li>
          <li>
            <span className="font-mono">Get Health Sample</span> — Heart Rate
            Variability, today
          </li>
          <li>
            <span className="font-mono">Get Health Sample</span> — Resting Heart
            Rate, today
          </li>
          <li>
            <span className="font-mono">Get Health Sample</span> — Step Count,
            today
          </li>
          <li>
            <span className="font-mono">Get Health Sample</span> — Active
            Energy, today
          </li>
          <li>
            <span className="font-mono">Get Contents of URL</span> — POST to the
            endpoint above. Headers:{' '}
            <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>{' '}
            and <span className="font-mono">Content-Type: application/json</span>.
            Request Body: a JSON dict with the 14 HealthKit fields.
          </li>
        </ul>
      </>
    ),
  },
  {
    n: '04',
    body: (
      <>
        Schedule via the <span className="font-mono">Automation</span> tab to
        run every morning at 7am.
      </>
    ),
  },
  {
    n: '05',
    body: (
      <>
        Run it once to verify — refresh{' '}
        <Link href="/dashboard" className="text-accent underline">
          /dashboard
        </Link>{' '}
        and your biometrics should land.
      </>
    ),
  },
];

function StepCards() {
  return (
    <ol className="space-y-2">
      {SETUP_STEPS.map((s) => (
        <li
          key={s.n}
          className="glass flex gap-4 rounded-xl border border-border p-4"
        >
          <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
            {s.n}
          </span>
          <div className="flex-1 text-sm leading-relaxed text-foreground">
            {s.body}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Some browsers block clipboard outside of user gesture; ignore quietly.
    }
  }

  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-glass-1 px-3 py-2 font-mono text-xs text-foreground">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-glass-2 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-foreground"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function AppleWatchIntegrationPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state — surfaces the raw token + endpoint exactly once.
  const [issued, setIssued] = useState<ProvisionResponse | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/integrations/apple-watch');
      if (!res.ok) {
        setStatus(null);
        return;
      }
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function provision() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/apple-watch/provision', {
        method: 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'failed to provision');
        return;
      }
      const data = (await res.json()) as ProvisionResponse;
      setIssued(data);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Apple Watch? Your phone will stop syncing.')) return;
    setBusy(true);
    try {
      await fetch('/api/integrations/apple-watch', { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

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
        <div className="eyebrow text-accent">iOS sync</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          Apple Watch
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Browsers can&rsquo;t read HealthKit, but a one-time iOS Shortcut can.
          Provision a token below, paste it into the Shortcut, and your phone
          will POST sleep, HRV, RHR, and movement to Protocol every morning.
        </p>
      </header>

      <section className="glass rounded-2xl p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-xl border border-border bg-glass-2 p-2 text-accent">
            <Smartphone size={18} />
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-xl text-foreground">Webhook</h2>
            <p className="mt-0.5 text-xs text-muted">
              Per-account bearer token. SHA-256-hashed at rest; raw token shown
              once.
            </p>
          </div>
          {status?.connected ? (
            <span className="rounded-full border border-fiber/30 bg-fiber-light px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fiber">
              · connected
            </span>
          ) : null}
        </div>

        {status?.connected ? (
          <div className="space-y-4">
            <CopyableField label="Endpoint URL" value={status.endpoint_url} />

            <div className="rounded-xl border border-border bg-glass-1 p-3 text-sm">
              <div className="eyebrow">Last sync</div>
              <div className="mt-1 font-mono text-foreground">
                {relativeTime(status.last_used_at)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={provision}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
              >
                <RefreshCcw size={14} />
                {busy ? 'Working…' : 'Re-provision (rotates token)'}
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 size={14} /> Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              Connect to generate a bearer token and webhook URL. You&rsquo;ll
              see them once — copy them straight into the Shortcut.
            </p>
            {error ? (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            ) : null}
            <button
              onClick={provision}
              disabled={busy}
              className="rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
            >
              {busy ? 'Provisioning…' : 'Connect'}
            </button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="eyebrow text-accent">Shortcut setup</div>
        <StepCards />
      </section>

      {issued ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
            onClick={() => setIssued(null)}
          />
          <div className="glass relative w-full max-w-lg rounded-2xl border border-border p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow text-accent">One-time secret</div>
                <h3 className="mt-1 font-serif text-2xl text-foreground">
                  Token issued
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="rounded-lg border border-border bg-glass-2 p-1.5 text-muted transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Copy these into your iOS Shortcut now. The token is shown once;
              if you lose it, re-provision (the old token stops working).
            </p>

            <div className="mt-4 space-y-3">
              <CopyableField label="Endpoint URL" value={issued.endpoint_url} />
              <CopyableField label="Bearer token" value={issued.token} />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent"
              >
                I&rsquo;ve copied them
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
