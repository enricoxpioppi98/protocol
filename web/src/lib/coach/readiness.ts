import type { BiometricsDaily } from '@/lib/types/models';

/**
 * Readiness score (0-100) synthesized from a single day of biometrics.
 *
 * This is a pure-frontend, population-baseline heuristic — we have no per-user
 * baseline yet, so the curves below are coarse. The output is one number plus
 * a band (red/yellow/green) and a one-sentence English explanation suitable
 * for surfacing at the top of the BiometricsCard.
 *
 * Design rules:
 *  - Each subscore is 0-100, or null if the underlying field is null.
 *  - The composite is a weighted average over the *present* subscores
 *    (weights renormalized so a missing field doesn't penalize the user).
 *  - If every subscore is null, the composite is null and the band is
 *    "unknown" — we never invent a score from nothing.
 */

// ------------------------------------------------------------------
// Weights
// ------------------------------------------------------------------
// Sleep dominates because it's the single best-correlated signal with
// next-day performance and the most reliably populated. HRV is the next
// most informative recovery proxy. RHR is a slower-moving trend signal.
// Stress is a noisy Garmin composite, so it gets the smallest weight.
const WEIGHTS = {
  sleep: 0.4,
  hrv: 0.3,
  rhr: 0.2,
  stress: 0.1,
} as const;

export type ReadinessBand = 'red' | 'yellow' | 'green' | 'unknown';

export interface ReadinessSubscores {
  sleep: number | null;
  hrv: number | null;
  rhr: number | null;
  stress: number | null;
}

export interface ReadinessResult {
  score: number | null;
  band: ReadinessBand;
  explanation: string;
  subscores: ReadinessSubscores;
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Sleep subscore: Garmin's sleep_score is already 0-100, so we just clamp.
 */
function sleepSubscore(sleepScore: number | null | undefined): number | null {
  if (sleepScore == null) return null;
  return clamp(sleepScore, 0, 100);
}

/**
 * HRV subscore: linear ramp from 25ms (0) to 75ms (100), so 50ms maps to 50.
 * Population-baseline only — once we have per-user 7-day baselines we should
 * swap this for a z-score against the user's own rolling mean.
 */
function hrvSubscore(hrvMs: number | null | undefined): number | null {
  if (hrvMs == null) return null;
  return clamp(((hrvMs - 25) * 100) / 50, 0, 100);
}

/**
 * RHR subscore: lower is better. 75bpm → 0, 60bpm → 50, 45bpm → 100.
 * Same caveat as HRV — this should eventually be a per-user delta.
 */
function rhrSubscore(restingHr: number | null | undefined): number | null {
  if (restingHr == null) return null;
  return clamp(((75 - restingHr) * 100) / 30, 0, 100);
}

/**
 * Stress subscore: Garmin stress_avg is 0-100, lower is better, so we invert.
 */
function stressSubscore(stressAvg: number | null | undefined): number | null {
  if (stressAvg == null) return null;
  return clamp(100 - stressAvg, 0, 100);
}

/**
 * Pick a one-sentence explanation. Templates are matched against the
 * dominant driver of the result — i.e. which subscore is highest (green) or
 * lowest (red/yellow). Keep this small and predictable.
 */
function explain(
  band: ReadinessBand,
  subs: ReadinessSubscores
): string {
  if (band === 'unknown') {
    return 'Enter biometrics to see your readiness.';
  }

  const present = (
    Object.entries(subs).filter(([, v]) => v != null) as Array<
      [keyof ReadinessSubscores, number]
    >
  );

  if (band === 'green') {
    // Highlight the two strongest contributors when we have them.
    const top = [...present].sort((a, b) => b[1] - a[1]);
    const hrvStrong = subs.hrv != null && subs.hrv >= 60;
    const sleepStrong = subs.sleep != null && subs.sleep >= 75;
    if (hrvStrong && sleepStrong) {
      return 'All systems green — HRV holding, sleep solid. Push the planned session.';
    }
    if (top[0]?.[0] === 'sleep') {
      return 'All systems green — sleep solid. Push the planned session.';
    }
    if (top[0]?.[0] === 'hrv') {
      return 'All systems green — HRV holding. Push the planned session.';
    }
    return 'All systems green — recovery markers look good. Push the planned session.';
  }

  if (band === 'red') {
    // How many subscores are themselves "red" (<50)?
    const reds = present.filter(([, v]) => v < 50).length;
    if (reds >= 3) {
      return 'Three signs of poor recovery — keep it Z2 today.';
    }
    // Pick the worst driver to call out.
    const worst = [...present].sort((a, b) => a[1] - b[1])[0];
    switch (worst?.[0]) {
      case 'sleep':
        return 'Sleep was light — keep it Z2 today.';
      case 'hrv':
        return 'HRV is suppressed — keep it Z2 today.';
      case 'rhr':
        return 'Resting HR is elevated — keep it Z2 today.';
      case 'stress':
        return 'Stress load is high — keep it Z2 today.';
      default:
        return 'Recovery markers look poor — keep it Z2 today.';
    }
  }

  // Yellow: mixed signals. Try to pair the worst and best driver.
  const sorted = [...present].sort((a, b) => a[1] - b[1]);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  if (worst && best && worst[0] !== best[0]) {
    if (worst[0] === 'sleep' && best[0] === 'hrv') {
      return 'Mixed signals — sleep is light but HRV is OK. Bias toward technique work over PRs.';
    }
    if (worst[0] === 'hrv' && best[0] === 'sleep') {
      return 'Mixed signals — HRV is down but sleep was OK. Bias toward technique work over PRs.';
    }
  }
  return 'Mixed signals — recovery is OK but not great. Bias toward technique work over PRs.';
}

export function computeReadiness(
  b: BiometricsDaily | null
): ReadinessResult {
  const subscores: ReadinessSubscores = {
    sleep: b ? sleepSubscore(b.sleep_score) : null,
    hrv: b ? hrvSubscore(b.hrv_ms) : null,
    rhr: b ? rhrSubscore(b.resting_hr) : null,
    stress: b ? stressSubscore(b.stress_avg) : null,
  };

  const present: Array<{ value: number; weight: number }> = [];
  if (subscores.sleep != null) {
    present.push({ value: subscores.sleep, weight: WEIGHTS.sleep });
  }
  if (subscores.hrv != null) {
    present.push({ value: subscores.hrv, weight: WEIGHTS.hrv });
  }
  if (subscores.rhr != null) {
    present.push({ value: subscores.rhr, weight: WEIGHTS.rhr });
  }
  if (subscores.stress != null) {
    present.push({ value: subscores.stress, weight: WEIGHTS.stress });
  }

  if (present.length === 0) {
    return {
      score: null,
      band: 'unknown',
      explanation: explain('unknown', subscores),
      subscores,
    };
  }

  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  const weighted = present.reduce((s, p) => s + p.value * p.weight, 0);
  const score = Math.round(weighted / totalWeight);

  let band: ReadinessBand;
  if (score >= 75) band = 'green';
  else if (score >= 50) band = 'yellow';
  else band = 'red';

  return {
    score,
    band,
    explanation: explain(band, subscores),
    subscores,
  };
}

// ------------------------------------------------------------------
// Smoke checks (documentation, not executed at runtime)
// ------------------------------------------------------------------
//
// 1) "Hypertrophy day" — well-rested, ready to push:
//      { sleep_score: 88, hrv_ms: 62, resting_hr: 52, stress_avg: 25 }
//      sleep=88, hrv=(62-25)*2=74, rhr=(75-52)*100/30≈76.7, stress=75
//      composite ≈ 88*.4 + 74*.3 + 76.7*.2 + 75*.1 = 35.2+22.2+15.3+7.5 ≈ 80
//      → score ~80, band=green, explanation mentions HRV+sleep solid.
//
// 2) "Rest day" — bad sleep + suppressed HRV + elevated RHR + high stress:
//      { sleep_score: 45, hrv_ms: 28, resting_hr: 70, stress_avg: 70 }
//      sleep=45, hrv=(28-25)*2=6, rhr=(75-70)*100/30≈16.7, stress=30
//      composite ≈ 45*.4 + 6*.3 + 16.7*.2 + 30*.1 = 18+1.8+3.3+3 ≈ 26
//      → score ~26, band=red, "Three signs of poor recovery — keep it Z2 today."
//
// 3) "Missing biometrics" — null prop, or prop with all-null fields:
//      computeReadiness(null) → { score: null, band: 'unknown',
//        explanation: 'Enter biometrics to see your readiness.', subscores: all null }
//      Same for a BiometricsDaily where every metric is null.
//
// Edge cases handled:
//  - Out-of-range inputs (e.g. hrv_ms=200) are clamped to [0,100] subscore.
//  - NaN inputs collapse to the lower bound (0) via clamp's NaN guard.
//  - Partial data (e.g. only sleep_score present) computes a score from just
//    that subscore by renormalizing weights — we never penalize for missing
//    fields, we just rely more heavily on what we have.
//  - Garmin 'manual' source vs 'garmin' source is irrelevant here; we only
//    look at the numeric fields.

// ============================================================================
// Personalized variant (Wave 5 phase 2): uses the user's own trailing baseline
// for HRV and RHR instead of population norms. Sleep and stress stay absolute
// (sleep_score is already 0-100 from Garmin, stress is 0-100 from Garmin).
// ============================================================================

export interface PersonalizedReadinessOpts {
  today: BiometricsDaily | null;
  /** All known biometric rows. We slice to days strictly before `todayDate`. */
  history: BiometricsDaily[];
  /** ISO YYYY-MM-DD anchor for the baseline window. */
  todayDate: string;
  /** Days of trailing history. Default 30. */
  baselineWindow?: number;
}

export interface PersonalizedReadinessResult extends ReadinessResult {
  /** True when at least one of HRV/RHR was scored against the user's own baseline. */
  personalized: boolean;
  /** Median used for personalized scoring; null when insufficient data. */
  personal_baseline: {
    hrv_ms: number | null;
    resting_hr: number | null;
  };
}

const PERSONAL_BASELINE_MIN_SAMPLES = 7;

interface MetricStats {
  median: number | null;
  stdDev: number;
  n: number;
}

function metricStats(
  rows: BiometricsDaily[],
  field: 'hrv_ms' | 'resting_hr'
): MetricStats {
  const vals: number[] = [];
  for (const r of rows) {
    const v = r[field];
    if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < PERSONAL_BASELINE_MIN_SAMPLES) {
    return { median: null, stdDev: 0, n: vals.length };
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance =
    vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  return { median, stdDev: Math.sqrt(variance), n: vals.length };
}

/**
 * Convert a z-score into a 0-100 subscore.
 *   z =  0  → 70 (in the user's normal range, "fine")
 *   z = +1  → 90 (a clear positive deviation)
 *   z = -1  → 50 (a clear negative deviation)
 *   z = +2  → 100 / z = -2 → 30, clamped.
 *
 * `higherIsBetter=true` for HRV (more is better); `false` for RHR.
 */
function zToSubscore(
  todayValue: number | null,
  stats: MetricStats,
  higherIsBetter: boolean
): number | null {
  if (todayValue == null || stats.median == null) return null;
  // Floor stdDev at 1 so a flat baseline doesn't divide by zero / produce
  // implausible z-scores.
  const sd = Math.max(stats.stdDev, 1);
  const direction = higherIsBetter ? 1 : -1;
  const z = ((todayValue - stats.median) / sd) * direction;
  return clamp(70 + z * 20, 0, 100);
}

export function computePersonalizedReadiness(
  opts: PersonalizedReadinessOpts
): PersonalizedReadinessResult {
  const { today, history, todayDate } = opts;
  const window = opts.baselineWindow ?? 30;

  const baselineRows = history.filter((r) => r.date < todayDate).slice(-window);
  const hrvStats = metricStats(baselineRows, 'hrv_ms');
  const rhrStats = metricStats(baselineRows, 'resting_hr');

  // Personal-first; fall back to population subscore when baseline is too thin.
  const hrvPersonal = today ? zToSubscore(today.hrv_ms, hrvStats, true) : null;
  const rhrPersonal = today ? zToSubscore(today.resting_hr, rhrStats, false) : null;

  const subscores: ReadinessSubscores = {
    sleep: today ? sleepSubscore(today.sleep_score) : null,
    hrv: hrvPersonal ?? (today ? hrvSubscore(today.hrv_ms) : null),
    rhr: rhrPersonal ?? (today ? rhrSubscore(today.resting_hr) : null),
    stress: today ? stressSubscore(today.stress_avg) : null,
  };

  const present: Array<{ value: number; weight: number }> = [];
  if (subscores.sleep != null)
    present.push({ value: subscores.sleep, weight: WEIGHTS.sleep });
  if (subscores.hrv != null)
    present.push({ value: subscores.hrv, weight: WEIGHTS.hrv });
  if (subscores.rhr != null)
    present.push({ value: subscores.rhr, weight: WEIGHTS.rhr });
  if (subscores.stress != null)
    present.push({ value: subscores.stress, weight: WEIGHTS.stress });

  if (present.length === 0) {
    return {
      score: null,
      band: 'unknown',
      explanation: explain('unknown', subscores),
      subscores,
      personalized: false,
      personal_baseline: { hrv_ms: hrvStats.median, resting_hr: rhrStats.median },
    };
  }

  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  const weighted = present.reduce((s, p) => s + p.value * p.weight, 0);
  const score = Math.round(weighted / totalWeight);

  let band: ReadinessBand;
  if (score >= 75) band = 'green';
  else if (score >= 50) band = 'yellow';
  else band = 'red';

  const personalized =
    hrvPersonal != null || rhrPersonal != null;

  return {
    score,
    band,
    explanation: explain(band, subscores),
    subscores,
    personalized,
    personal_baseline: { hrv_ms: hrvStats.median, resting_hr: rhrStats.median },
  };
}
