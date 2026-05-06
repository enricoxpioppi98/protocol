'use client';

import { useState } from 'react';
import { Sparkles, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Track 23 (v3) — Seed demo data card.
 *
 * Glass card mounted on /settings. POSTs to /api/demo/seed and renders one
 * of four states:
 *   - idle:   pitch + "Seed demo data" CTA
 *   - busy:   spinner + "Seeding 90 days of biometrics…"
 *   - success: green check + per-entity counts + "Reload your dashboard."
 *   - error:  red icon + the server's error message + a Retry button
 *
 * Dismissable. Once the user has run the seed (or explicitly dismissed),
 * a localStorage flag hides the card on subsequent visits — set on
 * success and on dismiss. The flag clears if the route changes shape (new
 * version key) so future iterations of the demo can re-prompt.
 */

const DISMISS_KEY = 'protocol_seed_demo_dismissed_v1';

interface SeedResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
  seeded?: {
    biometrics: number;
    briefings: number;
    chat: number;
    blood_panels: number;
    blood_markers: number;
    glucose_readings: number;
    cycle_entries: number;
    genome_traits: number;
  };
}

type Phase = 'idle' | 'busy' | 'success' | 'error';

/**
 * Lazy initializer for the dismissed flag. Reading localStorage in the
 * useState initializer (instead of in a useEffect that calls setState) is
 * the React-recommended pattern for a one-time external-state read — it
 * avoids the "synchronous setState inside effect" cascade-render warning
 * and the visible flash of un-dismissed UI on mount.
 *
 * Guarded for SSR (window undefined) and for environments where
 * localStorage throws (private mode in older browsers, sandboxed iframes,
 * etc.). The fallback "show the card" is harmless since the seed route is
 * idempotent.
 */
function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function SeedDemoButton() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>('');
  const [seeded, setSeeded] = useState<SeedResponse['seeded'] | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // No-op if localStorage is unavailable; the card will reappear next
      // visit, which is harmless given the route's idempotency.
    }
    setDismissed(true);
  }

  async function handleSeed() {
    setPhase('busy');
    setError('');
    try {
      const res = await fetch('/api/demo/seed', { method: 'POST' });
      const data = (await res.json()) as SeedResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `seed failed (${res.status})`);
        setPhase('error');
        return;
      }
      setSeeded(data.seeded ?? null);
      setPhase('success');
      // Auto-dismiss on success — user has the success card already, so
      // hiding the prompt next visit feels right.
      try {
        localStorage.setItem(DISMISS_KEY, '1');
      } catch {
        /* noop */
      }
    } catch (err) {
      console.error('[seed-demo] failed', err);
      setError('network error');
      setPhase('error');
    }
  }

  if (dismissed && phase === 'idle') return null;

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5 sm:p-6">
      {/* Decorative inner sheen — same accent stripe as BriefingCard */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Sparkles size={14} />
          </span>
          <div>
            <div className="eyebrow">Demo mode</div>
            <div className="mt-0.5 font-serif text-xl leading-tight text-foreground">
              Seed <span className="italic text-muted">90 days</span>
            </div>
          </div>
        </div>
        {phase === 'idle' && (
          <button
            onClick={dismiss}
            aria-label="Dismiss demo seeder"
            className="rounded-lg p-1.5 text-muted/70 transition-colors hover:bg-glass-3 hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {phase === 'idle' && (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Populate your dashboard with realistic biometrics, briefings, a chat
            thread, blood markers, and a coherent genome panel. Idempotent —
            re-running refreshes the window.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/70 sm:grid-cols-3">
            <li>· 90d biometrics</li>
            <li>· 14d briefings</li>
            <li>· 20-msg chat</li>
            <li>· 6 genome traits</li>
            <li>· 2 blood panels</li>
            <li>· 28 glucose</li>
          </ul>
          <button
            onClick={handleSeed}
            className="group relative mt-5 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-accent/40 bg-accent/90 px-5 py-3 text-sm font-semibold tracking-wide text-white shadow-[0_8px_30px_-12px_rgb(96_165_250/0.6)] transition-all hover:bg-accent"
          >
            <Sparkles size={14} />
            Seed demo data
          </button>
        </>
      )}

      {phase === 'busy' && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-light px-4 py-4 text-sm text-foreground">
          <Loader2 size={16} className="animate-spin text-accent" />
          <span className="font-serif italic text-muted">
            Seeding 90 days of biometrics, 14 briefings, chat history…
          </span>
        </div>
      )}

      {phase === 'success' && seeded && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-fiber/30 bg-fiber-light px-4 py-3 text-sm text-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fiber text-white">
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="font-serif italic">
              Done. Reload your dashboard.
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted sm:grid-cols-4">
            <Stat n={seeded.biometrics} label="biometrics" />
            <Stat n={seeded.briefings} label="briefings" />
            <Stat n={seeded.chat} label="chat msgs" />
            <Stat n={seeded.genome_traits} label="traits" />
            <Stat n={seeded.blood_panels} label="panels" />
            <Stat n={seeded.blood_markers} label="markers" />
            <Stat n={seeded.glucose_readings} label="glucose" />
            <Stat n={seeded.cycle_entries} label="cycle" />
          </ul>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-glass-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground transition-colors hover:bg-glass-3"
          >
            Open dashboard
          </a>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white">
              <X size={12} strokeWidth={3} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-danger">Seed failed</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{error}</div>
            </div>
          </div>
          <button
            onClick={handleSeed}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent'
            )}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <li className="flex items-baseline gap-1">
      <span className="font-mono tabular-nums text-foreground">{n}</span>
      <span>{label}</span>
    </li>
  );
}
