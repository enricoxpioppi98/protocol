'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Mounts on the dashboard and (once per page load) POSTs to
 * `/api/sync/auto-backfill`. If the response contains filled days,
 * surfaces a dismissable inline banner that auto-fades after 6 seconds.
 *
 * No toast library — hand-rolled because we don't have one in the codebase
 * and the brief explicitly asks not to add one. The styling matches the
 * `glass-strong` / accent palette used elsewhere on the dashboard.
 *
 * Silent cases:
 *   - errors: ['cooldown']   → render nothing (gate tripped)
 *   - errors: ['no_sources'] → render nothing
 *   - filled is empty + no error → render nothing
 *
 * Mixed-result case:
 *   - filled.whoop = 2, errors include 'garmin: 429' →
 *       "Filled 2 days of Whoop. Garmin pending."
 */

type Source = 'garmin' | 'whoop' | 'apple_watch';

interface BackfillResponse {
  filled?: Partial<Record<Source, number>>;
  errors?: string[];
}

const SOURCE_LABEL: Record<Source, string> = {
  garmin: 'Garmin',
  whoop: 'Whoop',
  apple_watch: 'Apple Watch',
};

export function AutoBackfillTrigger() {
  const [message, setMessage] = useState<string | null>(null);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/sync/auto-backfill', { method: 'POST' });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as BackfillResponse;
        if (cancelled) return;
        const msg = formatMessage(data);
        if (msg) setMessage(msg);
      } catch {
        // Silent: auto-backfill is best-effort. The dashboard should never
        // surface its own networking errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-fade after 6s. Two-stage: trigger the fade transition, then unmount.
  useEffect(() => {
    if (!message) return;
    const fadeAt = setTimeout(() => setHiding(true), 6000);
    const dropAt = setTimeout(() => setMessage(null), 6400);
    return () => {
      clearTimeout(fadeAt);
      clearTimeout(dropAt);
    };
  }, [message]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'glass-strong flex items-center gap-3 rounded-2xl px-4 py-3 transition-opacity duration-300',
        hiding ? 'opacity-0' : 'opacity-100'
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
        <CheckCircle2 size={15} />
      </span>
      <div className="flex-1 text-sm text-foreground">{message}</div>
      <button
        type="button"
        onClick={() => {
          setHiding(true);
          setTimeout(() => setMessage(null), 250);
        }}
        className="text-muted transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function formatMessage(data: BackfillResponse): string | null {
  const filled = data.filled ?? {};
  const filledEntries = (Object.entries(filled) as Array<[Source, number]>).filter(
    ([, n]) => typeof n === 'number' && n > 0
  );

  if (filledEntries.length === 0) return null;

  // Skip cooldown / no_sources noise — frontend stays silent in those cases.
  // They're already rejected above by `filledEntries.length === 0` because
  // those responses ship with `filled: {}`.

  // Build the "filled" sentence — singular for a single source, combined for
  // multiple.
  let main: string;
  if (filledEntries.length === 1) {
    const [source, n] = filledEntries[0]!;
    main = `Filled ${n} day${n === 1 ? '' : 's'} of ${SOURCE_LABEL[source]} data`;
  } else {
    const total = filledEntries.reduce((acc, [, n]) => acc + n, 0);
    const names = filledEntries
      .map(([s]) => SOURCE_LABEL[s])
      .join(' and ');
    main = `Filled ${total} day${total === 1 ? '' : 's'} across ${names}`;
  }

  // If any errors are present (per-source failures from the orchestrator),
  // call them out softly so the user knows something else is still pending.
  const errors = (data.errors ?? []).filter(
    (e) => e !== 'cooldown' && e !== 'no_sources'
  );
  if (errors.length > 0) {
    const pending = parseSourcesFromErrors(errors);
    if (pending.length > 0) {
      main += `. ${pending.join(' and ')} pending.`;
    }
  } else {
    main += '.';
  }

  return main;
}

/**
 * Extract source labels from per-source error strings of the form
 * `"<source>: <message>"`. Non-matching strings are dropped.
 */
function parseSourcesFromErrors(errors: string[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const colon = e.indexOf(':');
    if (colon <= 0) continue;
    const src = e.slice(0, colon).trim();
    if (src === 'garmin' || src === 'whoop' || src === 'apple_watch') {
      const label = SOURCE_LABEL[src as Source];
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}
