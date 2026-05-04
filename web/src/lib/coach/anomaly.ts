/**
 * Anomaly detection — pure helper that flags when today's biometrics deviate
 * meaningfully from the user's own trailing baseline. The briefing pipeline
 * (Track 14) will call this to lead its recovery note with phrasing like:
 *
 *   "Your HRV is unusually low for you — last time this happened was 04/12
 *    after two nights of <6h sleep. Today's plan accounts for that."
 *
 * This module is intentionally self-contained: no DB calls, no network, no
 * `Date.now()` outside the `today` parameter (caller pins the day so tests
 * are deterministic). Mirrors the style of `lib/sync/health-score.ts`:
 * constants at the top, single primary function, inline `console.assert`
 * test cases at the bottom in a comment block.
 *
 * Algorithm (per metric):
 *
 *   1. Locate today's row by matching `date === today` in `history`.
 *   2. Collect the trailing `window` days **excluding today** as the baseline.
 *   3. Skip the metric if today's value is null/undefined OR fewer than
 *      `window/2` non-null observations exist in the baseline (insufficient
 *      data — silence beats false alarms).
 *   4. Compute baseline_median + baseline_stdev (population stdev). Floor the
 *      stdev at ε so flat data doesn't blow up the z-score.
 *   5. z = (today - median) / max(stdev, ε). |z| < zThreshold → no signal.
 *   6. severity bands: |z| > 3 → severe, > 2 → notable, > 1.5 → mild.
 *   7. similar_past = up to 3 baseline rows whose |z| also exceeded the
 *      threshold in the *same* direction (caller can say "last time this
 *      happened was…"). Most recent first.
 *   8. Sort all returned signals by |z| descending.
 *
 * Track 14 is responsible for wiring this into `lib/coach/context.ts`. Don't
 * import this from there until that ticket lands.
 */

import type { BiometricsDaily } from '@/lib/types/models';

// --- formula constants (tweak with care; tests below pin the math) ---
export const ANOMALY_DEFAULT_WINDOW = 28;
export const ANOMALY_DEFAULT_Z_THRESHOLD = 1.5;
export const ANOMALY_SEVERE_Z = 3;
export const ANOMALY_NOTABLE_Z = 2;
export const ANOMALY_MILD_Z = 1.5;
/** Floor for stdev so flat baselines don't produce infinite z-scores. */
export const ANOMALY_STDEV_FLOOR = 1e-6;
export const ANOMALY_SIMILAR_PAST_LIMIT = 3;

/**
 * Default metrics scanned when the caller doesn't override. These are the
 * recovery-relevant signals the coach actually personalizes against — every
 * other column in `BiometricsDaily` is either derived from these or too noisy
 * (raw step counts, body battery sub-fields) to anchor a recovery note on.
 */
export const ANOMALY_DEFAULT_METRICS: ReadonlyArray<keyof BiometricsDaily> = [
  'hrv_ms',
  'sleep_score',
  'sleep_duration_minutes',
  'resting_hr',
  'training_load_acute',
];

/**
 * Briefer-friendly labels for the metrics we know about. Anything not listed
 * falls back to a humanised version of the column name.
 */
const METRIC_LABELS: Partial<Record<keyof BiometricsDaily, string>> = {
  hrv_ms: 'HRV',
  sleep_score: 'Sleep score',
  sleep_duration_minutes: 'Sleep duration',
  resting_hr: 'Resting HR',
  training_load_acute: 'Training load (acute)',
  training_load_chronic: 'Training load (chronic)',
  stress_avg: 'Stress',
  total_steps: 'Steps',
  vo2max: 'VO2 max',
  sleep_efficiency: 'Sleep efficiency',
  deep_sleep_minutes: 'Deep sleep',
  rem_sleep_minutes: 'REM sleep',
};

export type AnomalySeverity = 'mild' | 'notable' | 'severe';
export type AnomalyDirection = 'below' | 'above';

export interface AnomalySimilarPast {
  date: string;
  value: number;
  z_score: number;
}

export interface AnomalySignal {
  metric: keyof BiometricsDaily;
  metric_label: string;
  today_value: number;
  baseline_median: number;
  baseline_stdev: number;
  /** Signed: negative = below baseline, positive = above. */
  z_score: number;
  direction: AnomalyDirection;
  severity: AnomalySeverity;
  /** Up to 3 days from the baseline window where |z| also exceeded threshold
   *  in the same direction. Most-recent first. */
  similar_past: AnomalySimilarPast[];
}

export interface ComputeAnomaliesOptions {
  /** Chronological, oldest first. Should include today's row. */
  history: BiometricsDaily[];
  /** ISO date YYYY-MM-DD. */
  today: string;
  /** Days of trailing baseline (excluding today). Default 28. */
  window?: number;
  /** |z| threshold for an anomaly to be returned. Default 1.5. */
  zThreshold?: number;
  /** Metrics to scan. Default: hrv, sleep_score, sleep_duration,
   *  resting_hr, training_load_acute. */
  metrics?: ReadonlyArray<keyof BiometricsDaily>;
}

// --- internal helpers --------------------------------------------------------

function labelFor(metric: keyof BiometricsDaily): string {
  const explicit = METRIC_LABELS[metric];
  if (explicit) return explicit;
  // Fall back to a humanised column name.
  return String(metric)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityFor(absZ: number): AnomalySeverity | null {
  if (absZ > ANOMALY_SEVERE_Z) return 'severe';
  if (absZ > ANOMALY_NOTABLE_Z) return 'notable';
  if (absZ > ANOMALY_MILD_Z) return 'mild';
  return null;
}

/** Population stdev (divides by N, not N-1). */
function stdev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) {
    const d = v - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function readNumber(
  row: BiometricsDaily,
  metric: keyof BiometricsDaily
): number | null {
  const v = row[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// --- main API ---------------------------------------------------------------

export function computeAnomalies(opts: ComputeAnomaliesOptions): AnomalySignal[] {
  const {
    history,
    today,
    window = ANOMALY_DEFAULT_WINDOW,
    zThreshold = ANOMALY_DEFAULT_Z_THRESHOLD,
    metrics = ANOMALY_DEFAULT_METRICS,
  } = opts;

  const todayRow = history.find((r) => r.date === today);
  if (!todayRow) return [];

  // Baseline = trailing `window` days strictly before today. We rely on the
  // contract that `history` is chronological oldest-first, but also defend
  // against a caller that hasn't sorted by filtering on date string compare
  // (ISO YYYY-MM-DD lexicographic == chronological).
  const baselineRows = history
    .filter((r) => r.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-window);

  const minBaselineN = Math.floor(window / 2);
  const signals: AnomalySignal[] = [];

  for (const metric of metrics) {
    const todayValue = readNumber(todayRow, metric);
    if (todayValue === null) continue;

    const baselineValues: number[] = [];
    const baselineByDate: Array<{ date: string; value: number }> = [];
    for (const row of baselineRows) {
      const v = readNumber(row, metric);
      if (v === null) continue;
      baselineValues.push(v);
      baselineByDate.push({ date: row.date, value: v });
    }

    if (baselineValues.length < minBaselineN) continue;

    const baselineMedian = median(baselineValues);
    const mean =
      baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
    const baselineStdev = stdev(baselineValues, mean);
    const denom = Math.max(baselineStdev, ANOMALY_STDEV_FLOOR);

    const z = (todayValue - baselineMedian) / denom;
    const absZ = Math.abs(z);
    const severity = severityFor(absZ);
    if (!severity) continue;

    const direction: AnomalyDirection = z < 0 ? 'below' : 'above';

    // similar_past: walk baseline most-recent first, collect rows whose own
    // z (vs the same baseline median + stdev) exceeded the threshold in the
    // SAME direction. Capped at 3.
    const similar_past: AnomalySimilarPast[] = [];
    for (let i = baselineByDate.length - 1; i >= 0; i--) {
      const row = baselineByDate[i]!;
      const rowZ = (row.value - baselineMedian) / denom;
      if (Math.abs(rowZ) <= zThreshold) continue;
      const rowDir: AnomalyDirection = rowZ < 0 ? 'below' : 'above';
      if (rowDir !== direction) continue;
      similar_past.push({
        date: row.date,
        value: row.value,
        z_score: roundTo(rowZ, 2),
      });
      if (similar_past.length >= ANOMALY_SIMILAR_PAST_LIMIT) break;
    }

    signals.push({
      metric,
      metric_label: labelFor(metric),
      today_value: todayValue,
      baseline_median: roundTo(baselineMedian, 2),
      baseline_stdev: roundTo(baselineStdev, 2),
      z_score: roundTo(z, 2),
      direction,
      severity,
      similar_past,
    });
  }

  // Sort by absolute severity desc — the briefing should lead with the
  // strongest deviation.
  signals.sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score));
  return signals;
}

/**
 * Multi-line, human-readable summary suitable for a system-prompt block.
 * Empty string when no signals are provided — callers can `if (s) prompt += s`
 * without a special case.
 *
 * Example output:
 *
 *   ANOMALIES (today vs trailing 28d baseline):
 *   - HRV is severe-ly below baseline (today 38, median 62, z=-2.85). Similar past days: 2026-04-12 (z=-2.41), 2026-03-30 (z=-1.92).
 *   - Resting HR is mild-ly above baseline (today 64, median 56, z=1.61). Similar past days: 2026-04-13 (z=1.74).
 */
export function summarizeForPrompt(signals: AnomalySignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('ANOMALIES (today vs trailing baseline):');
  for (const s of signals) {
    const past =
      s.similar_past.length === 0
        ? 'No similar past days in the baseline window.'
        : 'Similar past days: ' +
          s.similar_past
            .map((p) => `${p.date} (z=${formatZ(p.z_score)})`)
            .join(', ') +
          '.';
    lines.push(
      `- ${s.metric_label} is ${s.severity}-ly ${s.direction} baseline ` +
        `(today ${formatNumber(s.today_value)}, median ${formatNumber(s.baseline_median)}, ` +
        `z=${formatZ(s.z_score)}). ${past}`
    );
  }
  return lines.join('\n');
}

// --- formatting helpers (kept private; callers should use the API above) ----

function roundTo(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function formatZ(z: number): string {
  // Always show sign so "z=-2.41" reads obviously below baseline.
  const sign = z >= 0 ? '+' : '';
  return `${sign}${z.toFixed(2)}`;
}

function formatNumber(n: number): string {
  // Integers stay clean; floats get two decimals.
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

/* ============================================================================
 * Inline test cases (uncomment + run in any sandbox to verify the math).
 * Kept here because there's no test runner wired up yet (`web/tests/` has only
 * a Playwright scaffold). Mirrors the convention in `lib/sync/health-score.ts`.
 *
 * import { computeAnomalies, summarizeForPrompt } from './anomaly';
 * import type { BiometricsDaily } from '@/lib/types/models';
 *
 * const TODAY = '2026-05-04';
 *
 * function dayBefore(iso: string, n: number): string {
 *   const d = new Date(iso + 'T00:00:00Z');
 *   d.setUTCDate(d.getUTCDate() - n);
 *   return d.toISOString().slice(0, 10);
 * }
 *
 * function row(date: string, hrv: number | null, sleep: number | null = null): BiometricsDaily {
 *   return {
 *     user_id: 'u',
 *     date,
 *     sleep_score: sleep,
 *     sleep_duration_minutes: null,
 *     hrv_ms: hrv,
 *     resting_hr: null,
 *     stress_avg: null,
 *     training_load_acute: null,
 *     training_load_chronic: null,
 *     total_steps: null,
 *     floors_climbed: null,
 *     active_minutes: null,
 *     vigorous_minutes: null,
 *     moderate_minutes: null,
 *     total_kcal_burned: null,
 *     active_kcal_burned: null,
 *     vo2max: null,
 *     max_hr: null,
 *     min_hr: null,
 *     deep_sleep_minutes: null,
 *     rem_sleep_minutes: null,
 *     light_sleep_minutes: null,
 *     awake_sleep_minutes: null,
 *     sleep_efficiency: null,
 *     body_battery_high: null,
 *     body_battery_low: null,
 *     body_battery_charged: null,
 *     body_battery_drained: null,
 *     source: 'garmin',
 *     raw: null,
 *     fetched_at: '2026-05-04T00:00:00Z',
 *     updated_at: '2026-05-04T00:00:00Z',
 *   };
 * }
 *
 * // 1. Severe HRV drop with one similar past day → returns one signal,
 * //    severity 'severe', direction 'below', similar_past not empty.
 * {
 *   const history: BiometricsDaily[] = [];
 *   // 28 baseline days centered around HRV ~60 with stdev ~3 (random-ish).
 *   for (let i = 28; i >= 1; i--) {
 *     // Sprinkle one prior anomaly at i=12 (so date is 04-22 if today is 05-04).
 *     // Wait — we want a prior anomaly within window, so pick i=12 → ~22 days ago.
 *     const hrv = i === 12 ? 40 : 58 + (i % 5);
 *     history.push(row(dayBefore(TODAY, i), hrv));
 *   }
 *   history.push(row(TODAY, 38)); // today: severe drop
 *   const signals = computeAnomalies({ history, today: TODAY });
 *   console.assert(signals.length === 1, '#1 length', signals);
 *   const s = signals[0];
 *   console.assert(s.metric === 'hrv_ms', '#1 metric', s);
 *   console.assert(s.direction === 'below', '#1 direction', s);
 *   console.assert(s.severity === 'severe' || s.severity === 'notable', '#1 severity', s);
 *   console.assert(s.similar_past.length >= 1, '#1 similar_past', s);
 *   console.assert(s.similar_past.every(p => p.z_score < 0), '#1 same-direction past', s);
 * }
 *
 * // 2. No-anomaly case: today equals the baseline median exactly → no signals.
 * {
 *   const history: BiometricsDaily[] = [];
 *   for (let i = 28; i >= 1; i--) history.push(row(dayBefore(TODAY, i), 60));
 *   history.push(row(TODAY, 60));
 *   const signals = computeAnomalies({ history, today: TODAY });
 *   console.assert(signals.length === 0, '#2 expected no signals', signals);
 *   console.assert(summarizeForPrompt(signals) === '', '#2 empty summary', signals);
 * }
 *
 * // 3. Insufficient-data case: only 5 baseline observations on a 28-day
 * //    window → must skip even if today's value is wildly off.
 * {
 *   const history: BiometricsDaily[] = [];
 *   for (let i = 5; i >= 1; i--) history.push(row(dayBefore(TODAY, i), 60));
 *   history.push(row(TODAY, 10)); // would be a huge anomaly if computed
 *   const signals = computeAnomalies({ history, today: TODAY });
 *   console.assert(signals.length === 0, '#3 expected no signals (insufficient data)', signals);
 * }
 *
 * // 4. Flat-data ε guard: 28 identical baseline values, today differs.
 * //    With stdev=0 the floor (1e-6) kicks in, producing a huge but finite z;
 * //    severity is whichever band the magnitude lands in. Either way: NO crash,
 * //    NO Infinity, NO NaN.
 * {
 *   const history: BiometricsDaily[] = [];
 *   for (let i = 28; i >= 1; i--) history.push(row(dayBefore(TODAY, i), 60));
 *   history.push(row(TODAY, 50));
 *   const signals = computeAnomalies({ history, today: TODAY });
 *   console.assert(signals.length === 1, '#4 length', signals);
 *   const s = signals[0];
 *   console.assert(Number.isFinite(s.z_score), '#4 finite z', s);
 *   console.assert(s.severity === 'severe', '#4 severe', s);
 *   console.assert(s.direction === 'below', '#4 direction', s);
 * }
 *
 * // 5. Insufficient-data threshold is window/2 — 14 obs on a 28-day window
 * //    is exactly the floor and SHOULD produce a signal (>= 14 passes).
 * {
 *   const history: BiometricsDaily[] = [];
 *   // 14 valid + 14 nulls scattered through the window.
 *   for (let i = 28; i >= 1; i--) {
 *     history.push(row(dayBefore(TODAY, i), i % 2 === 0 ? 60 + (i % 4) : null));
 *   }
 *   history.push(row(TODAY, 30));
 *   const signals = computeAnomalies({ history, today: TODAY });
 *   console.assert(signals.length === 1, '#5 length (boundary 14 obs)', signals);
 * }
 *
 * // 6. summarizeForPrompt smoke test — non-empty when signals exist.
 * {
 *   const history: BiometricsDaily[] = [];
 *   for (let i = 28; i >= 1; i--) history.push(row(dayBefore(TODAY, i), 60));
 *   history.push(row(TODAY, 30));
 *   const out = summarizeForPrompt(computeAnomalies({ history, today: TODAY }));
 *   console.assert(out.startsWith('ANOMALIES'), '#6 header', out);
 *   console.assert(out.includes('HRV'), '#6 metric label', out);
 *   console.assert(out.includes('below'), '#6 direction', out);
 * }
 * ========================================================================= */
