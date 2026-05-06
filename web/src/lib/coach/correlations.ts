/**
 * Track 24 (v3): personal correlation discovery.
 *
 * Pure module — no DB calls, no network, no `Date.now()` outside the inputs.
 * Caller (the cron route at /api/coach/patterns/recompute) fetches the
 * per-day rows for the trailing window and hands them in here. We test a
 * fixed set of candidate patterns (HRV vs dinner time, sleep vs prior-day
 * load, etc.), gate on significance + sample size, and return the survivors
 * sorted by |r|.
 *
 * Significance gate (per pattern):
 *   - n      >= 14 paired observations (two weeks of overlap)
 *   - |r|    >= 0.3
 *   - p      <  0.05  (two-tailed t-test on r)
 *
 * The math is intentionally small + self-contained. p-value uses the
 * regularized incomplete beta function via a Lentz continued fraction —
 * compact (~50 lines), accurate to ~1e-8 across the t-distribution tails we
 * care about (n in [14, 90]). For r=0.4, n=20 we recover p ≈ 0.08 — the
 * spec's anchor case.
 *
 * Style mirrors `lib/coach/anomaly.ts`: constants at the top, single primary
 * function, helpers below, console.assert test cases at the bottom of the
 * file (commented out — paste into a sandbox to verify).
 */

// ============================================================================
// Public types
// ============================================================================

export interface PatternFinding {
  /** Stable key — one current row per (user_id, pattern_kind). */
  pattern_kind: string;
  /** Short, plain-English line suitable for the briefing or dashboard. */
  finding_text: string;
  metric_a: string;
  metric_b: string;
  /** Signed Pearson or Spearman r in [-1, 1]. */
  correlation: number;
  /** Two-tailed p-value from t-distribution with n-2 df. */
  p_value: number;
  sample_size: number;
  /** Raw stats — means, group breakdowns, anything the dashboard wants to cite. */
  payload: Record<string, unknown>;
}

/**
 * Per-day rows; keys are ISO YYYY-MM-DD dates. Each value is whatever metrics
 * are available for that day. The caller is responsible for joining the
 * various source tables into this shape; downstream patterns just read the
 * fields they need and skip days where the input is null.
 */
export interface CorrelationInputs {
  per_day: Record<string, DayRow>;
}

export interface DayRow {
  hrv_ms?: number | null;
  sleep_score?: number | null;
  sleep_duration_minutes?: number | null;
  resting_hr?: number | null;
  training_load_acute?: number | null;
  total_steps?: number | null;
  /** Latest 'Dinner' meal of the day, minutes since midnight. */
  dinner_time_minutes?: number | null;
  /** True iff a beer / wine / cocktail / spirit was logged that day. */
  alcohol_logged?: boolean | null;
  /** 24h time-in-range (e.g. 70-180 mg/dL) percentage. */
  glucose_tir_pct?: number | null;
  cycle_phase?: 'menstruation' | 'follicular' | 'ovulation' | 'luteal' | null;
}

// ============================================================================
// Significance gate
// ============================================================================

export const PATTERN_MIN_N = 14;
export const PATTERN_MIN_ABS_R = 0.3;
export const PATTERN_MAX_P = 0.05;

// ============================================================================
// Stats primitives
// ============================================================================

/**
 * Pearson product-moment r over paired (xs, ys). Returns r=0, n=0 when fewer
 * than 2 paired observations are present or when either series has zero
 * variance (the formula would otherwise divide by zero).
 */
export function pearson(xs: number[], ys: number[]): { r: number; n: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { r: 0, n };

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return { r: 0, n };
  const r = num / Math.sqrt(denX * denY);
  // Clamp into [-1, 1] to defend against floating-point overshoot.
  return { r: Math.max(-1, Math.min(1, r)), n };
}

/**
 * Spearman rank correlation. Implemented as the Pearson r over the rank
 * transforms of xs and ys; ties get mid-ranks (the standard "fractional rank"
 * convention) so two equal values don't bias either direction.
 */
export function spearman(xs: number[], ys: number[]): { r: number; n: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { r: 0, n };
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  return pearson(rx, ry);
}

function ranks(values: number[]): number[] {
  const n = values.length;
  // Sort indices by their value, ascending.
  const idx = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    // Walk the run of ties.
    while (j + 1 < n && values[idx[j + 1]!]! === values[idx[i]!]!) j++;
    // Assign mid-rank (1-indexed) to every tied position in the run.
    const midRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!] = midRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Two-tailed p-value for Pearson/Spearman r at sample size n.
 *
 *   t  = r * sqrt((n-2) / (1 - r^2))
 *   df = n - 2
 *   p  = 2 * (1 - F_t(|t|; df))
 *
 * F_t expressed via the regularized incomplete beta function:
 *   1 - F_t(|t|; df) = 0.5 * I_x(df/2, 1/2),   x = df / (df + t^2)
 *
 * I_x is computed by the Lentz continued fraction (NR §6.4) — accurate to
 * ~1e-8 across (n in [14, 90], r in [-1, 1]), more than enough for a 0.05
 * gate. Returns 1 when |r| >= 1 or n < 3 (no meaningful test possible).
 */
export function pValueTwoTailed(r: number, n: number): number {
  if (!Number.isFinite(r) || !Number.isFinite(n)) return 1;
  if (n < 3) return 1;
  const absR = Math.min(1, Math.abs(r));
  if (absR >= 1) return 0; // perfect correlation → p=0 within float precision
  const df = n - 2;
  const t2 = (absR * absR * df) / (1 - absR * absR);
  // x = df / (df + t^2)
  const x = df / (df + t2);
  // 1 - F_t = 0.5 * I_x(df/2, 1/2); two-tailed doubles → I_x(df/2, 1/2).
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

// ----------------------------------------------------------------------------
// Regularized incomplete beta — Lentz continued fraction (NR §6.4).
// I_x(a, b) = (x^a * (1-x)^b / (a * B(a,b))) * cf(x; a, b)
// where cf is the continued fraction expansion. We compute log-gamma via the
// Lanczos approximation, then exponentiate at the end.
// ----------------------------------------------------------------------------

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Symmetry: I_x(a, b) = 1 - I_{1-x}(b, a) — converges faster on the side
  // closer to 0.
  const front =
    Math.exp(
      lnGamma(a + b) -
        lnGamma(a) -
        lnGamma(b) +
        a * Math.log(x) +
        b * Math.log(1 - x),
    );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaCF(x, a, b)) / a;
  }
  return 1 - (front * betaCF(1 - x, b, a)) / b;
}

function betaCF(x: number, a: number, b: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Lanczos log-gamma (g=7, n=9) — accurate to ~1e-15 for x > 0. */
function lnGamma(x: number): number {
  const COF = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection: lnΓ(x) = ln(π/sin(πx)) - lnΓ(1-x)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  let xx = x - 1;
  let a = COF[0]!;
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += COF[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

// ============================================================================
// Pattern catalog
// ============================================================================

/**
 * Stable ids of every pattern this module tests. The cron uses this set to
 * delete stale rows whose pattern_kind is in the candidate set but didn't
 * survive the latest run's significance gate.
 */
export const PATTERN_KINDS = [
  'hrv_vs_dinner_time',
  'hrv_vs_alcohol_yesterday',
  'sleep_score_vs_workout_intensity_yesterday',
  'rhr_vs_acute_load',
  'steps_vs_sleep_score',
  'glucose_tir_vs_hrv',
  'cycle_phase_vs_hrv',
  'weekend_vs_weekday_hrv',
] as const;

export type PatternKind = (typeof PATTERN_KINDS)[number];

// ============================================================================
// Main entry
// ============================================================================

/**
 * Discover patterns over the user's per-day inputs. Returns the findings that
 * pass the significance gate, sorted by |correlation| desc. Empty array when
 * nothing's significant or there isn't enough data.
 */
export function discoverPatterns(inputs: CorrelationInputs): PatternFinding[] {
  const days = sortedDayKeys(inputs.per_day);
  if (days.length === 0) return [];

  const findings: PatternFinding[] = [];

  pushIfSignificant(findings, hrvVsDinnerTime(inputs, days));
  pushIfSignificant(findings, hrvVsAlcoholYesterday(inputs, days));
  pushIfSignificant(findings, sleepVsPriorWorkoutLoad(inputs, days));
  pushIfSignificant(findings, rhrVsAcuteLoad(inputs, days));
  pushIfSignificant(findings, stepsVsSleepScore(inputs, days));
  pushIfSignificant(findings, glucoseTirVsHrv(inputs, days));
  pushIfSignificant(findings, cyclePhaseVsHrv(inputs, days));
  pushIfSignificant(findings, weekendVsWeekdayHrv(inputs, days));

  // Strongest signals first.
  findings.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return findings;
}

function pushIfSignificant(out: PatternFinding[], f: PatternFinding | null): void {
  if (!f) return;
  if (f.sample_size < PATTERN_MIN_N) return;
  if (Math.abs(f.correlation) < PATTERN_MIN_ABS_R) return;
  if (f.p_value >= PATTERN_MAX_P) return;
  out.push(f);
}

// ============================================================================
// Pattern implementations
// ============================================================================

/**
 * Pattern 1: HRV (today) vs previous day's dinner time.
 *
 * Hypothesis: late dinners cost morning HRV. Pearson r between the two; if
 * negative + significant, "your HRV is X ms lower per hour later you eat".
 */
function hrvVsDinnerTime(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = []; // dinner_time_minutes (yesterday)
  const ys: number[] = []; // hrv_ms (today)
  for (let i = 1; i < days.length; i++) {
    const yest = inputs.per_day[days[i - 1]!];
    const today = inputs.per_day[days[i]!];
    if (
      isNum(yest?.dinner_time_minutes) &&
      isNum(today?.hrv_ms)
    ) {
      xs.push(yest!.dinner_time_minutes!);
      ys.push(today!.hrv_ms!);
    }
  }
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);

  // Effect-size copy: avg HRV on "late dinner" (>=20:00) vs "early" days.
  const lateHrv: number[] = [];
  const earlyHrv: number[] = [];
  for (let i = 0; i < n; i++) {
    if (xs[i]! >= 20 * 60) lateHrv.push(ys[i]!);
    else earlyHrv.push(ys[i]!);
  }
  const meanLate = mean(lateHrv);
  const meanEarly = mean(earlyHrv);
  const diff = meanLate - meanEarly;

  let text: string;
  if (lateHrv.length >= 3 && earlyHrv.length >= 3 && Number.isFinite(diff)) {
    const direction = diff < 0 ? 'lower' : 'higher';
    text = `Your HRV is ${Math.abs(roundTo(diff, 0))}ms ${direction} on average after dinners past 8pm (n=${n}, r=${formatR(r)}).`;
  } else {
    const verb = r < 0 ? 'lower' : 'higher';
    text = `Later dinners track with ${verb} morning HRV (n=${n}, r=${formatR(r)}).`;
  }

  return {
    pattern_kind: 'hrv_vs_dinner_time',
    finding_text: text,
    metric_a: 'hrv_ms',
    metric_b: 'dinner_time_minutes_prev_day',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: {
      mean_hrv_late_dinner: meanLate,
      mean_hrv_early_dinner: meanEarly,
      n_late: lateHrv.length,
      n_early: earlyHrv.length,
      threshold_minutes: 20 * 60,
    },
  };
}

/**
 * Pattern 2: HRV today vs alcohol logged yesterday.
 *
 * Two-group split (alcohol y/n). We compute Pearson r between (1 if alcohol
 * yesterday else 0) and today's HRV — equivalent to a point-biserial r —
 * and report the group means in the payload + finding_text.
 */
function hrvVsAlcoholYesterday(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = []; // 1/0 alcohol yesterday
  const ys: number[] = []; // hrv today
  for (let i = 1; i < days.length; i++) {
    const yest = inputs.per_day[days[i - 1]!];
    const today = inputs.per_day[days[i]!];
    if (typeof yest?.alcohol_logged === 'boolean' && isNum(today?.hrv_ms)) {
      xs.push(yest.alcohol_logged ? 1 : 0);
      ys.push(today!.hrv_ms!);
    }
  }
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;

  // Need both groups represented.
  const yesGroup: number[] = [];
  const noGroup: number[] = [];
  for (let i = 0; i < n; i++) {
    if (xs[i] === 1) yesGroup.push(ys[i]!);
    else noGroup.push(ys[i]!);
  }
  if (yesGroup.length < 3 || noGroup.length < 3) return null;

  const p = pValueTwoTailed(r, n);
  const meanYes = mean(yesGroup);
  const meanNo = mean(noGroup);
  const diff = meanYes - meanNo;
  const verb = diff < 0 ? 'lower' : 'higher';
  const text = `Your HRV averages ${Math.abs(roundTo(diff, 0))}ms ${verb} the morning after alcohol (n=${n}, r=${formatR(r)}).`;

  return {
    pattern_kind: 'hrv_vs_alcohol_yesterday',
    finding_text: text,
    metric_a: 'hrv_ms',
    metric_b: 'alcohol_logged_prev_day',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: {
      mean_hrv_alcohol: meanYes,
      mean_hrv_no_alcohol: meanNo,
      n_alcohol: yesGroup.length,
      n_no_alcohol: noGroup.length,
    },
  };
}

/**
 * Pattern 3: Sleep score (today) vs yesterday's training load (acute).
 * Spearman — load distributions are heavy-tailed. Hypothesis: hard sessions
 * land in worse sleep that night.
 */
function sleepVsPriorWorkoutLoad(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = []; // training_load_acute (yesterday)
  const ys: number[] = []; // sleep_score (today)
  for (let i = 1; i < days.length; i++) {
    const yest = inputs.per_day[days[i - 1]!];
    const today = inputs.per_day[days[i]!];
    if (isNum(yest?.training_load_acute) && isNum(today?.sleep_score)) {
      xs.push(yest!.training_load_acute!);
      ys.push(today!.sleep_score!);
    }
  }
  const { r, n } = spearman(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);
  const verb = r < 0 ? 'worse' : 'better';
  const text = `Higher training load tracks with ${verb} sleep score the next night (n=${n}, ρ=${formatR(r)}).`;
  return {
    pattern_kind: 'sleep_score_vs_workout_intensity_yesterday',
    finding_text: text,
    metric_a: 'sleep_score',
    metric_b: 'training_load_acute_prev_day',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: {
      mean_load: mean(xs),
      mean_sleep: mean(ys),
      method: 'spearman',
    },
  };
}

/**
 * Pattern 4: Resting HR vs acute training load (same day). Pearson — both are
 * roughly normally distributed.
 */
function rhrVsAcuteLoad(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = []; // training_load_acute
  const ys: number[] = []; // resting_hr
  for (const d of days) {
    const row = inputs.per_day[d];
    if (isNum(row?.training_load_acute) && isNum(row?.resting_hr)) {
      xs.push(row!.training_load_acute!);
      ys.push(row!.resting_hr!);
    }
  }
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);
  const verb = r > 0 ? 'higher' : 'lower';
  const text = `Higher acute training load tracks with ${verb} resting HR the same day (n=${n}, r=${formatR(r)}).`;
  return {
    pattern_kind: 'rhr_vs_acute_load',
    finding_text: text,
    metric_a: 'resting_hr',
    metric_b: 'training_load_acute',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: { mean_rhr: mean(ys), mean_load: mean(xs) },
  };
}

/**
 * Pattern 5: Same-day steps vs sleep score. Pearson.
 */
function stepsVsSleepScore(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of days) {
    const row = inputs.per_day[d];
    if (isNum(row?.total_steps) && isNum(row?.sleep_score)) {
      xs.push(row!.total_steps!);
      ys.push(row!.sleep_score!);
    }
  }
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);
  const verb = r > 0 ? 'better' : 'worse';
  const text = `More daily steps track with ${verb} sleep scores (n=${n}, r=${formatR(r)}).`;
  return {
    pattern_kind: 'steps_vs_sleep_score',
    finding_text: text,
    metric_a: 'sleep_score',
    metric_b: 'total_steps',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: { mean_steps: mean(xs), mean_sleep: mean(ys) },
  };
}

/**
 * Pattern 6: Glucose time-in-range (24h) vs same-day HRV.
 */
function glucoseTirVsHrv(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of days) {
    const row = inputs.per_day[d];
    if (isNum(row?.glucose_tir_pct) && isNum(row?.hrv_ms)) {
      xs.push(row!.glucose_tir_pct!);
      ys.push(row!.hrv_ms!);
    }
  }
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);
  const verb = r > 0 ? 'higher' : 'lower';
  const text = `Days with more time in glucose range track with ${verb} HRV (n=${n}, r=${formatR(r)}).`;
  return {
    pattern_kind: 'glucose_tir_vs_hrv',
    finding_text: text,
    metric_a: 'hrv_ms',
    metric_b: 'glucose_tir_pct',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: { mean_tir: mean(xs), mean_hrv: mean(ys) },
  };
}

/**
 * Pattern 7: Cycle phase vs HRV.
 *
 * Group HRV by cycle phase, find the largest pairwise mean gap, encode it as
 * a Pearson r between an indicator (1 = high-HRV phase, 0 = low-HRV phase)
 * and HRV. The downstream gate then sees a signed effect size and a p-value
 * driven by sample size + within-group variance — ANOVA-lite.
 */
function cyclePhaseVsHrv(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const groups: Record<string, number[]> = {
    menstruation: [],
    follicular: [],
    ovulation: [],
    luteal: [],
  };
  let total = 0;
  for (const d of days) {
    const row = inputs.per_day[d];
    if (!row) continue;
    if (!row.cycle_phase || !isNum(row.hrv_ms)) continue;
    if (!(row.cycle_phase in groups)) continue;
    groups[row.cycle_phase]!.push(row.hrv_ms!);
    total++;
  }
  if (total < PATTERN_MIN_N) return null;

  // Need at least 2 phases with >=3 observations to even attempt.
  const populated = Object.entries(groups).filter(([, vs]) => vs.length >= 3);
  if (populated.length < 2) return null;

  // Pick the highest-mean and lowest-mean phases.
  const meansByPhase = populated.map(([phase, vs]) => ({
    phase,
    mean: mean(vs),
    n: vs.length,
  }));
  meansByPhase.sort((a, b) => a.mean - b.mean);
  const lowPhase = meansByPhase[0]!;
  const highPhase = meansByPhase[meansByPhase.length - 1]!;
  if (lowPhase.phase === highPhase.phase) return null;

  // Build the indicator-vs-HRV series across just those two phases.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const v of groups[highPhase.phase]!) {
    xs.push(1);
    ys.push(v);
  }
  for (const v of groups[lowPhase.phase]!) {
    xs.push(0);
    ys.push(v);
  }
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);
  const diff = roundTo(highPhase.mean - lowPhase.mean, 0);
  const text = `Your HRV runs ${Math.abs(diff)}ms higher in the ${highPhase.phase} phase than the ${lowPhase.phase} phase (n=${total}, r=${formatR(r)}).`;
  return {
    pattern_kind: 'cycle_phase_vs_hrv',
    finding_text: text,
    metric_a: 'hrv_ms',
    metric_b: 'cycle_phase',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: {
      group_means: Object.fromEntries(
        meansByPhase.map((g) => [g.phase, { mean: g.mean, n: g.n }]),
      ),
      high_phase: highPhase.phase,
      low_phase: lowPhase.phase,
      mean_diff: diff,
      total_observations: total,
    },
  };
}

/**
 * Pattern 8: Weekend (Sat/Sun) vs weekday (Mon-Fri) HRV. Same indicator-vs-
 * value Pearson construction as the cycle pattern.
 */
function weekendVsWeekdayHrv(
  inputs: CorrelationInputs,
  days: string[],
): PatternFinding | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const weekendVals: number[] = [];
  const weekdayVals: number[] = [];
  for (const d of days) {
    const row = inputs.per_day[d];
    if (!row || !isNum(row.hrv_ms)) continue;
    const dow = utcDayOfWeek(d);
    if (dow < 0) continue;
    const isWeekend = dow === 0 || dow === 6;
    xs.push(isWeekend ? 1 : 0);
    ys.push(row.hrv_ms!);
    (isWeekend ? weekendVals : weekdayVals).push(row.hrv_ms!);
  }
  if (weekendVals.length < 3 || weekdayVals.length < 3) return null;
  const { r, n } = pearson(xs, ys);
  if (n < PATTERN_MIN_N) return null;
  const p = pValueTwoTailed(r, n);
  const meanWeekend = mean(weekendVals);
  const meanWeekday = mean(weekdayVals);
  const diff = meanWeekend - meanWeekday;
  const verb = diff < 0 ? 'lower' : 'higher';
  const text = `Your HRV averages ${Math.abs(roundTo(diff, 0))}ms ${verb} on weekends vs weekdays (n=${n}, r=${formatR(r)}).`;
  return {
    pattern_kind: 'weekend_vs_weekday_hrv',
    finding_text: text,
    metric_a: 'hrv_ms',
    metric_b: 'is_weekend',
    correlation: r,
    p_value: p,
    sample_size: n,
    payload: {
      mean_weekend: meanWeekend,
      mean_weekday: meanWeekday,
      n_weekend: weekendVals.length,
      n_weekday: weekdayVals.length,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function roundTo(n: number, digits: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function formatR(r: number): string {
  // Always show sign so "r=-0.61" reads obviously inverse.
  const sign = r >= 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}`;
}

function sortedDayKeys(perDay: Record<string, DayRow>): string[] {
  // ISO YYYY-MM-DD lexicographic sort == chronological.
  return Object.keys(perDay).sort();
}

/**
 * UTC day-of-week for an ISO date. 0 = Sunday, 6 = Saturday. Returns -1 for
 * malformed input.
 */
function utcDayOfWeek(yyyymmdd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}/.test(yyyymmdd)) return -1;
  const d = new Date(`${yyyymmdd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return -1;
  return d.getUTCDay();
}

/* ============================================================================
 * Inline test cases (uncomment + run in any sandbox to verify the math).
 * Same convention as `lib/coach/anomaly.ts`. No test runner is wired up for
 * `web/src/lib/`, so we live with console.assert blocks behind a comment.
 *
 * import {
 *   discoverPatterns,
 *   pearson,
 *   spearman,
 *   pValueTwoTailed,
 *   PATTERN_KINDS,
 *   type CorrelationInputs,
 * } from './correlations';
 *
 * // 1. Pearson on a known-perfect line: y = 2x + 1 → r = 1, p = 0.
 * {
 *   const xs = [1, 2, 3, 4, 5];
 *   const ys = [3, 5, 7, 9, 11];
 *   const { r, n } = pearson(xs, ys);
 *   console.assert(Math.abs(r - 1) < 1e-12, '#1 r=1', r);
 *   console.assert(n === 5, '#1 n', n);
 *   console.assert(pValueTwoTailed(r, n) < 1e-9, '#1 p≈0');
 * }
 *
 * // 2. Spearman is rank-invariant: y monotonically increasing in x via a
 * //    nonlinear map → ρ = 1 even though Pearson < 1.
 * {
 *   const xs = [1, 2, 3, 4, 5];
 *   const ys = [1, 4, 9, 16, 25]; // y = x^2
 *   const { r: pearsonR } = pearson(xs, ys);
 *   const { r: rhoR } = spearman(xs, ys);
 *   console.assert(Math.abs(rhoR - 1) < 1e-12, '#2 spearman=1', rhoR);
 *   console.assert(pearsonR < 1, '#2 pearson<1', pearsonR);
 * }
 *
 * // 3. Spec anchor: r=0.4, n=20 → p ≈ 0.08 (between 0.07 and 0.09).
 * {
 *   const p = pValueTwoTailed(0.4, 20);
 *   console.assert(p > 0.07 && p < 0.09, '#3 p≈0.08', p);
 * }
 *
 * // 4. Tie-handling in Spearman: all-equal y series → ranks tie at midpoint,
 * //    correlation = 0 (no variance in y).
 * {
 *   const xs = [1, 2, 3, 4, 5];
 *   const ys = [7, 7, 7, 7, 7];
 *   const { r } = spearman(xs, ys);
 *   console.assert(r === 0, '#4 zero-variance y', r);
 * }
 *
 * // 5. discoverPatterns rejects below-threshold |r| even if n + p look fine.
 * {
 *   // Build 30 days where load and rhr are independent (rng noise).
 *   const per_day: CorrelationInputs['per_day'] = {};
 *   for (let i = 0; i < 30; i++) {
 *     const date = `2026-04-${String(i + 1).padStart(2, '0')}`;
 *     // Pseudo-random but deterministic: a sin curve + a different sin curve.
 *     per_day[date] = {
 *       training_load_acute: 50 + 10 * Math.sin(i),
 *       resting_hr: 55 + 5 * Math.sin(i + 1.7),
 *     };
 *   }
 *   const findings = discoverPatterns({ per_day });
 *   const rhrLoad = findings.find(f => f.pattern_kind === 'rhr_vs_acute_load');
 *   // Independent series should rarely pass; if they do, |r| must clear 0.3.
 *   if (rhrLoad) console.assert(Math.abs(rhrLoad.correlation) >= 0.3, '#5 r-gate');
 * }
 *
 * // 6. discoverPatterns surfaces a rigged late-dinner → low-HRV pattern.
 * {
 *   const per_day: CorrelationInputs['per_day'] = {};
 *   for (let i = 0; i < 30; i++) {
 *     const date = `2026-04-${String(i + 1).padStart(2, '0')}`;
 *     // Linear: late dinner (high minutes) → low next-day HRV.
 *     const dinnerMin = 18 * 60 + (i % 5) * 30; // 1080..1320
 *     const hrv = 70 - (dinnerMin - 18 * 60) * 0.05 + (i % 3) * 1.5;
 *     per_day[date] = {
 *       dinner_time_minutes: dinnerMin,
 *       hrv_ms: hrv,
 *     };
 *   }
 *   const findings = discoverPatterns({ per_day });
 *   const f = findings.find(x => x.pattern_kind === 'hrv_vs_dinner_time');
 *   console.assert(!!f, '#6 surfaced');
 *   console.assert(f!.correlation < -0.3, '#6 negative r');
 *   console.assert(f!.p_value < 0.05, '#6 significant');
 *   console.assert(f!.sample_size >= 14, '#6 n');
 * }
 *
 * // 7. PATTERN_KINDS is the public ground-truth set the cron uses to GC
 * //    stale findings. Each pattern_kind a finding emits must be in it.
 * {
 *   const per_day: CorrelationInputs['per_day'] = {};
 *   for (let i = 0; i < 30; i++) {
 *     const date = `2026-04-${String(i + 1).padStart(2, '0')}`;
 *     per_day[date] = {
 *       hrv_ms: 60 + (i % 5),
 *       sleep_score: 70 + (i % 7),
 *       resting_hr: 55 + (i % 3),
 *       training_load_acute: 50 + (i % 6),
 *       total_steps: 8000 + i * 100,
 *       dinner_time_minutes: 19 * 60 + (i % 4) * 15,
 *       alcohol_logged: i % 4 === 0,
 *     };
 *   }
 *   const findings = discoverPatterns({ per_day });
 *   for (const f of findings) {
 *     console.assert(
 *       (PATTERN_KINDS as readonly string[]).includes(f.pattern_kind),
 *       '#7 pattern_kind catalog',
 *       f.pattern_kind,
 *     );
 *   }
 * }
 * ========================================================================= */
