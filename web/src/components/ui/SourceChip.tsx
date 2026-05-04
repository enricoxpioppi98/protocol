'use client';

/**
 * SourceChip — tiny mono-uppercase pill that advertises which integration
 * produced a biometric value (Track 6, source attribution).
 *
 * The merged view (`biometrics_daily_merged`, migration 013) emits one row
 * per (user_id, date) with values priority-picked across every connected
 * source. The chip surfaces the *primary* (priority-winner) source for that
 * row so the user can tell, at a glance, "today's HRV came from Whoop". For
 * per-metric attribution we'd need to query the underlying table — out of
 * scope for v2; the merged view's `source` column is the single source of
 * truth here.
 *
 * Visual: glass-2 background + 1px border in the source's accent color
 * (var(--source-XXX), set in globals.css). Text is mono-uppercase, sized
 * to read as secondary metadata next to a card eyebrow — never larger
 * than the metric values themselves.
 *
 * Tooltip: plain HTML `title=""` (no Headless UI / Radix dep). Format
 * follows `Intl.RelativeTimeFormat`:
 *   < 1h    → "fetched Nm ago"
 *   1–48h   → "fetched Nh ago"
 *   > 48h   → "fetched Nd ago"
 */

import { cn } from '@/lib/utils/cn';
import type { BiometricsSource } from '@/lib/types/models';

interface Props {
  source: BiometricsSource;
  /**
   * Seconds since the value was fetched. Optional — when omitted, no
   * "fetched … ago" tooltip is rendered (chip still shows the source
   * label + has its native title fallback).
   */
  freshnessSeconds?: number;
  /** xs = inline-with-eyebrow (default). sm = slightly larger for cards. */
  size?: 'xs' | 'sm';
  className?: string;
}

const LABEL: Record<BiometricsSource, string> = {
  garmin: 'Garmin',
  whoop: 'Whoop',
  apple_watch: 'Apple Watch',
  manual: 'Manual',
};

const COLOR_VAR: Record<BiometricsSource, string> = {
  garmin: 'var(--source-garmin)',
  whoop: 'var(--source-whoop)',
  apple_watch: 'var(--source-apple-watch)',
  manual: 'var(--source-manual)',
};

/**
 * Format a freshness value as a relative phrase. Uses Intl.RelativeTimeFormat
 * with English locale (the rest of the app is en-only today). Returns null
 * when seconds is undefined / not finite, so callers can skip the tooltip.
 */
function formatFreshness(seconds: number | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  // Negative (future) clamps to "just now" rather than "in N minutes" — a
  // future fetched_at would mean clock skew, not a useful coaching signal.
  const s = Math.max(0, Math.floor(seconds));

  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  } catch {
    // Older runtimes without Intl.RelativeTimeFormat — degrade quietly.
    return null;
  }

  if (s < 60) return 'fetched just now';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `fetched ${rtf.format(-minutes, 'minute')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `fetched ${rtf.format(-hours, 'hour')}`;
  const days = Math.floor(hours / 24);
  return `fetched ${rtf.format(-days, 'day')}`;
}

export function SourceChip({
  source,
  freshnessSeconds,
  size = 'xs',
  className,
}: Props) {
  // Defensive: if a future migration adds a new source string we don't know
  // about, render the raw value rather than crashing. Same `as any` pattern
  // used elsewhere in the codebase for forward-compat enum reads.
  const label = LABEL[source] ?? String(source);
  const color = COLOR_VAR[source] ?? 'var(--app-border-strong)';
  const tooltip = formatFreshness(freshnessSeconds);

  // Sizes match the existing eyebrow rhythm: xs lines up with the 10px
  // eyebrow font; sm bumps a notch for cards where the eyebrow isn't shown.
  const sizeCls =
    size === 'sm'
      ? 'text-[10px] px-2 py-[3px] tracking-[0.18em]'
      : 'text-[9px] px-1.5 py-[2px] tracking-[0.16em]';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-mono uppercase',
        'bg-glass-2 backdrop-blur-sm',
        'transition-colors hover:bg-glass-3',
        sizeCls,
        className
      )}
      style={{
        // Hairline border + text in the source accent so the chip reads as
        // an accent at-a-glance, but stays secondary to the metric values
        // around it (no fill).
        border: `1px solid ${color}`,
        color,
      }}
      // Native title attr — no extra dep needed. Browser shows on hover &
      // long-press on touch.
      title={tooltip ?? `Source: ${label}`}
      aria-label={tooltip ? `${label} — ${tooltip}` : `Source: ${label}`}
    >
      {label}
    </span>
  );
}

/**
 * Helper: convert an ISO timestamp (e.g. `biometrics.fetched_at`) to a
 * seconds-ago number suitable for `freshnessSeconds`. Returns undefined
 * when the input is null / unparseable so the chip skips the tooltip
 * rather than show "fetched NaN ago".
 */
export function freshnessSecondsFrom(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, (Date.now() - t) / 1000);
}
