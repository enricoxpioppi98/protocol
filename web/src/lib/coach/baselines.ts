/**
 * Rolling self-baselines (Track 9, v3).
 *
 * The pitch the v2 architecture earns: now that `biometrics_daily_merged`
 * gives us one canonical row per day per user — composite-PK on
 * (user_id, date) — we can finally compute a user's *own* trailing baseline
 * for every metric and tell them how today deviates from THEIR norm. Not
 * population norms, not vendor-supplied bands. Their own.
 *
 * This module is **pure**: no DB calls, no network, no `Date.now()` outside
 * the explicit `today` parameter. Components and the (future) coaching layer
 * compose with it.
 *
 * Math (so the strip caption can show its work):
 *
 *   computeRollingBaseline:
 *     - takes the last `window` rows (excluding today) sorted by date asc.
 *     - returns median (robust to spikes), mean, stdDev (population, n),
 *       and `count` of finite values seen.
 *     - returns null when fewer than 3 values exist (a baseline of 1 or 2
 *       points is noise, and downstream chips render "n/a" cleanly).
 *
 *   formatDelta(today, baseline):
 *     - delta = today - baseline.median
 *     - sigma = (today - baseline.mean) / baseline.stdDev   (z-score)
 *     - label cutoffs:
 *         |z| ≤ 0.5         → "in range"
 *         0.5 < |z| ≤ 1.5   → "below" / "above" (signed)
 *         |z| > 1.5         → "well below" / "well above"
 *     - if stdDev is 0 (all-same baseline), z is 0 — no deviation possible.
 *
 * Why the "exclude today" rule: if today's value is rolled into its own
 * baseline, the delta is mechanically pulled toward zero, which understates
 * how unusual today actually is. The whole point is to compare today vs
 * yesterday-and-before.
 */

import type { BiometricsDaily } from '@/lib/types/models';

export type BaselineWindow = 7 | 30 | 90 | 365;

export const BASELINE_WINDOWS: BaselineWindow[] = [7, 30, 90, 365];

/** Minimum finite values needed before we'll claim a baseline. */
export const BASELINE_MIN_SAMPLES = 3;

/** Threshold above which the chip turns yellow. */
export const SIGMA_WARN = 1;
/** Threshold above which the chip turns red. */
export const SIGMA_ALERT = 2;

export interface RollingBaseline {
  median: number;
  mean: number;
  /** Population standard deviation. Zero when all baseline values are equal. */
  stdDev: number;
  /** Number of finite values that contributed (`< BASELINE_MIN_SAMPLES` → null result). */
  count: number;
  /** Inclusive lower bound of the window (YYYY-MM-DD), or null if no rows. */
  windowStart: string | null;
  /** Inclusive upper bound of the window (YYYY-MM-DD), or null if no rows. */
  windowEnd: string | null;
}

export type DeltaLabel =
  | 'well below'
  | 'below'
  | 'in range'
  | 'above'
  | 'well above';

export interface DeltaSummary {
  /** Absolute difference today − baseline.median. */
  delta: number;
  /** Z-score: (today − mean) / stdDev. 0 if stdDev = 0. */
  sigma: number;
  /** Human-readable bucket. */
  label: DeltaLabel;
}

// ---- public API ------------------------------------------------------------

/**
 * Compute a self-baseline over a trailing window from `today` (today's row
 * is excluded so today can be honestly compared against it).
 *
 * @param rows    BiometricsDaily rows. Order doesn't matter; we filter and sort.
 * @param metric  Field to baseline (e.g. 'hrv_ms', 'sleep_score').
 * @param window  Trailing window length in days (7 / 30 / 90 / 365).
 * @param today   ISO YYYY-MM-DD of "today". Defaults to the largest date in `rows`.
 *                Pinned for tests; production callers usually pass today's date.
 *
 * @returns A baseline summary, or `null` if the window contains fewer than
 *          `BASELINE_MIN_SAMPLES` finite values for that metric.
 */
export function computeRollingBaseline(
  rows: BiometricsDaily[],
  metric: keyof BiometricsDaily,
  window: BaselineWindow,
  today?: string,
): RollingBaseline | null {
  if (rows.length === 0) return null;

  // Resolve the anchor date. We accept an explicit ISO; otherwise we pick
  // the latest date present in `rows`. ISO YYYY-MM-DD lex-sorts == time sort.
  let anchor = today;
  if (!anchor) {
    let maxDate = '';
    for (const r of rows) if (r.date > maxDate) maxDate = r.date;
    anchor = maxDate;
  }
  if (!anchor) return null;

  // Window bounds: `[anchor - window, anchor - 1]` inclusive (today excluded).
  const anchorMs = isoToMs(anchor);
  if (anchorMs == null) return null;
  const lowerMs = anchorMs - window * MS_PER_DAY;
  const upperMs = anchorMs - 1; // strictly before today

  const values: number[] = [];
  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  for (const row of rows) {
    const ms = isoToMs(row.date);
    if (ms == null) continue;
    if (ms < lowerMs || ms > upperMs) continue;
    const raw = row[metric];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    values.push(raw);
    if (windowStart == null || row.date < windowStart) windowStart = row.date;
    if (windowEnd == null || row.date > windowEnd) windowEnd = row.date;
  }

  if (values.length < BASELINE_MIN_SAMPLES) return null;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // Population stdDev (n, not n-1): we're describing the user's known
  // history, not estimating a hidden population.
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const median = computeMedian(values);

  return {
    median,
    mean,
    stdDev,
    count: values.length,
    windowStart,
    windowEnd,
  };
}

/**
 * Bucket a `today` value against a baseline. Used by the strip chip to pick
 * a color and a phrase. See module docstring for the σ cutoffs.
 */
export function formatDelta(
  today: number,
  baseline: { median: number; mean: number; stdDev: number },
): DeltaSummary {
  const delta = today - baseline.median;
  const sigma =
    baseline.stdDev > 0 ? (today - baseline.mean) / baseline.stdDev : 0;

  const abs = Math.abs(sigma);
  let label: DeltaLabel;
  if (abs <= 0.5) label = 'in range';
  else if (abs <= 1.5) label = sigma < 0 ? 'below' : 'above';
  else label = sigma < 0 ? 'well below' : 'well above';

  return { delta, sigma, label };
}

/**
 * Pick today's value for a metric out of a BiometricsDaily array. Convenience
 * wrapper used by the strip — exported so the coach can reuse it.
 */
export function pickTodayValue(
  rows: BiometricsDaily[],
  metric: keyof BiometricsDaily,
  today?: string,
): number | null {
  if (rows.length === 0) return null;
  let anchor = today;
  if (!anchor) {
    let maxDate = '';
    for (const r of rows) if (r.date > maxDate) maxDate = r.date;
    anchor = maxDate;
  }
  if (!anchor) return null;

  for (const row of rows) {
    if (row.date !== anchor) continue;
    const raw = row[metric];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    return null;
  }
  return null;
}

// ---- internals -------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoToMs(iso: string): number | null {
  // Treat ISO YYYY-MM-DD as a UTC date so (b - a) / DAY is exactly N days
  // even across DST. Browsers' Date.parse handles this for the date-only
  // form, but we go through the explicit Date.UTC to avoid surprises.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return Date.UTC(y, mo - 1, d);
}

function computeMedian(values: number[]): number {
  // values is non-empty by caller contract.
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/* ============================================================================
 * Inline test cases (mirror of `health-score.ts` style — no test runner wired
 * up yet; lift verbatim when one lands).
 *
 * import {
 *   computeRollingBaseline,
 *   formatDelta,
 *   pickTodayValue,
 * } from './baselines';
 *
 * // Test fixtures: a simple 10-day HRV series ending 2026-05-04.
 * function row(date: string, hrv: number): any {
 *   return { date, hrv_ms: hrv, source: 'garmin' };
 * }
 * const SERIES = [
 *   row('2026-04-25', 50),
 *   row('2026-04-26', 52),
 *   row('2026-04-27', 48),
 *   row('2026-04-28', 51),
 *   row('2026-04-29', 49),
 *   row('2026-04-30', 53),
 *   row('2026-05-01', 50),
 *   row('2026-05-02', 52),
 *   row('2026-05-03', 51),
 *   row('2026-05-04', 42), // today: dropped 9 below median
 * ];
 *
 * // 1. 7-day baseline excludes today and computes from the prior 7 days.
 * //    Values: 49, 53, 50, 52, 51, 48, 51 (ordered by date desc → 7 most recent)
 * //    Wait — window = 7 means [today - 7, today - 1] = Apr 27 ... May 3 inclusive
 * //    That's 7 days: 48, 51, 49, 53, 50, 52, 51
 * //    Mean = (48+51+49+53+50+52+51)/7 = 354/7 ≈ 50.571
 * //    Median (sorted: 48,49,50,51,51,52,53) = 51
 * //    StdDev ≈ sqrt(mean((v-50.571)^2)) ≈ 1.555
 * {
 *   const r = computeRollingBaseline(SERIES, 'hrv_ms', 7, '2026-05-04');
 *   console.assert(r !== null, '#1 baseline');
 *   console.assert(r!.count === 7, '#1 count', r);
 *   console.assert(r!.median === 51, '#1 median', r);
 *   console.assert(Math.abs(r!.mean - 50.571) < 0.01, '#1 mean', r);
 *   console.assert(r!.windowStart === '2026-04-27', '#1 windowStart', r);
 *   console.assert(r!.windowEnd === '2026-05-03', '#1 windowEnd', r);
 * }
 *
 * // 2. formatDelta on today vs baseline → today=42, mean=50.571, sd≈1.555
 * //    sigma = (42 - 50.571) / 1.555 ≈ -5.51 → "well below"
 * {
 *   const r = computeRollingBaseline(SERIES, 'hrv_ms', 7, '2026-05-04')!;
 *   const d = formatDelta(42, r);
 *   console.assert(d.label === 'well below', '#2 label', d);
 *   console.assert(d.delta === 42 - 51, '#2 delta', d);
 *   console.assert(d.sigma < -1.5, '#2 sigma', d);
 * }
 *
 * // 3. Window with too few rows → null
 * {
 *   const r = computeRollingBaseline(SERIES.slice(0, 1), 'hrv_ms', 30, '2026-05-04');
 *   console.assert(r === null, '#3 too few', r);
 * }
 *
 * // 4. All-equal baseline → stdDev 0, sigma 0, label "in range"
 * {
 *   const flat = [
 *     row('2026-04-30', 50), row('2026-05-01', 50),
 *     row('2026-05-02', 50), row('2026-05-03', 50),
 *   ];
 *   const r = computeRollingBaseline(flat, 'hrv_ms', 30, '2026-05-04')!;
 *   console.assert(r.stdDev === 0, '#4 stdDev', r);
 *   const d = formatDelta(50, r);
 *   console.assert(d.sigma === 0 && d.label === 'in range', '#4 delta', d);
 * }
 *
 * // 5. pickTodayValue
 * {
 *   const v = pickTodayValue(SERIES, 'hrv_ms', '2026-05-04');
 *   console.assert(v === 42, '#5', v);
 * }
 *
 * // 6. 30-day window with only 10 days available → uses all 9 prior days.
 * {
 *   const r = computeRollingBaseline(SERIES, 'hrv_ms', 30, '2026-05-04');
 *   console.assert(r !== null && r.count === 9, '#6 count', r);
 * }
 *
 * // 7. Today is included in rows, but excluded from baseline. Verify by
 * //    flipping today's value to a wild outlier — baseline must not move.
 * {
 *   const series2 = [...SERIES.slice(0, -1), row('2026-05-04', 9999)];
 *   const r = computeRollingBaseline(series2, 'hrv_ms', 7, '2026-05-04')!;
 *   console.assert(r.median === 51, '#7 unaffected', r);
 * }
 *
 * // 8. above vs below labels — symmetric around median.
 * {
 *   const r = computeRollingBaseline(SERIES, 'hrv_ms', 7, '2026-05-04')!;
 *   console.assert(formatDelta(r.mean + 1.0 * r.stdDev, r).label === 'above');
 *   console.assert(formatDelta(r.mean + 2.0 * r.stdDev, r).label === 'well above');
 *   console.assert(formatDelta(r.mean - 1.0 * r.stdDev, r).label === 'below');
 *   console.assert(formatDelta(r.mean, r).label === 'in range');
 * }
 * ========================================================================= */
