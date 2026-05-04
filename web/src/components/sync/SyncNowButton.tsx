'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Small per-source "Sync now" button.
 *
 * POSTs to `/api/sync/run` with `{ sources: [source], force: true }`.
 * On result, surfaces the per-source `status` + `rowsAffected` inline so the
 * user gets feedback even before the realtime audit row lands.
 *
 * Apple Watch is push-only — the orchestrator returns
 * `skipped: 'push_only'`. We disable the button up front and tooltip the
 * reason so the user understands why.
 */

type SyncStatus = 'ok' | 'error' | 'skipped';
type SkipReason = 'cooldown' | 'push_only' | 'not_connected';

interface PerResult {
  source: string;
  status: SyncStatus;
  rowsAffected: number;
  reason?: SkipReason;
  errorMessage?: string;
}

interface Props {
  source: 'garmin' | 'whoop' | 'apple_watch';
  /** When false, the button stays disabled (no creds → nothing to sync). */
  enabled: boolean;
  /** Optional callback after the sync resolves so parents can refresh. */
  onComplete?: () => void;
  /** Optional small variant (used inside dense cards). */
  size?: 'sm' | 'md';
}

const SKIP_LABEL: Record<SkipReason, string> = {
  push_only: 'Apple Watch is push-only — the iOS Shortcut posts to Protocol on its own schedule.',
  cooldown: 'Synced recently. Wait a moment before retrying.',
  not_connected: 'Not connected.',
};

export function SyncNowButton({ source, enabled, onComplete, size = 'md' }: Props) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<PerResult | null>(null);

  const isPushOnly = source === 'apple_watch';
  const disabled = !enabled || busy || isPushOnly;

  async function run() {
    if (disabled) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [source], force: true }),
      });
      // Even non-2xx returns JSON, but guard anyway.
      const data = (await res.json().catch(() => ({}))) as {
        results?: PerResult[];
        error?: string;
      };
      const own = data.results?.find((r) => r.source === source) ?? null;
      if (own) {
        setFeedback(own);
      } else if (data.error) {
        setFeedback({
          source,
          status: 'error',
          rowsAffected: 0,
          errorMessage: data.error,
        });
      } else {
        setFeedback({
          source,
          status: 'error',
          rowsAffected: 0,
          errorMessage: `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setFeedback({
        source,
        status: 'error',
        rowsAffected: 0,
        errorMessage: e instanceof Error ? e.message : 'network error',
      });
    } finally {
      setBusy(false);
      onComplete?.();
    }
  }

  // Auto-clear the inline status after a few seconds so the button rests.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const tooltip = isPushOnly
    ? SKIP_LABEL.push_only
    : !enabled
      ? 'Connect first.'
      : 'Run a sync now';

  const padding = size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2';
  const text = size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        title={tooltip}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/90 font-mono uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40',
          padding,
          text
        )}
      >
        <RefreshCw size={12} className={cn(busy && 'animate-spin')} />
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {feedback ? <FeedbackPill result={feedback} /> : null}
    </div>
  );
}

function FeedbackPill({ result }: { result: PerResult }) {
  if (result.status === 'ok') {
    return (
      <span
        className="rounded-full border border-fiber/30 bg-fiber-light px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fiber"
        title={`${result.rowsAffected} row${result.rowsAffected === 1 ? '' : 's'} affected`}
      >
        · ok · {result.rowsAffected} row{result.rowsAffected === 1 ? '' : 's'}
      </span>
    );
  }
  if (result.status === 'skipped') {
    const why = result.reason ? SKIP_LABEL[result.reason] : 'skipped';
    return (
      <span
        className="rounded-full border border-border bg-glass-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted"
        title={why}
      >
        · skipped · {result.reason ?? 'reason unknown'}
      </span>
    );
  }
  return (
    <span
      className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-danger"
      title={result.errorMessage ?? 'sync failed'}
    >
      · error
    </span>
  );
}
