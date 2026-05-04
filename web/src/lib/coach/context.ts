import { createClient } from '@/lib/supabase/server';
import { computeCyclePhase } from '@/lib/cycle/phase';
import { computeAnomalies, type AnomalySignal } from './anomaly';
import { recallRelevant, type Recollection } from './memory';
import { relevantGenomeFlags, type GenomeFlag } from './genome-context';
import type {
  BiometricsDaily,
  BiometricsSource,
  BloodMarkerFlag,
  BloodMarkerReading,
  BloodPanel,
  CycleEntry,
  CyclePhase,
  DailyBriefing,
  DailyGoal,
  DiaryEntry,
  Food,
  GlucoseReading,
  Recipe,
  UserProfile,
} from '@/lib/types/models';

/**
 * Server-side context assembler. Reads the everything Claude needs to produce
 * a briefing or answer a chat message, in a single shape. Run inside the
 * briefing route and the chat route — same context = same prompt cache prefix.
 */

export type TrendTag = 'improving' | 'stable' | 'declining' | 'unknown';

export interface BiometricTrends {
  sleep_trend: TrendTag;
  hrv_trend: TrendTag;
  rhr_trend: TrendTag;
  training_load_trend: TrendTag;
}

export interface CoachContext {
  user_id: string;
  today: string; // YYYY-MM-DD
  profile: UserProfile | null;
  biometrics_today: BiometricsDaily | null; // falls back to yesterday if today missing
  /** Last 3 full days of biometrics (yesterday, day-before, day-before-that). Most-recent first. */
  biometrics_last_3_days: BiometricsDaily[];
  /** 7-day rolling baseline (last 7 days inclusive of today if available). */
  biometrics_baseline_7d: BiometricsDaily[];
  trends: BiometricTrends;
  age_years: number | null;
  goal_today: DailyGoal | null;
  macros_today: MacroAggregate;
  yesterday_workout: DailyBriefing['workout'] | null;
  /** Last 7 daily_briefing rows, ordered date desc. May be shorter for new users. */
  briefings_last_7d: DailyBriefing[];
  /** Compact rolling summary of the last 7 days of workouts (training continuity signal). */
  recent_workouts_summary: RecentWorkoutsSummary;
  /** Compact rolling summary of the last 7 days of meals (nutrition continuity signal). */
  recent_meals_summary: RecentMealsSummary;
  /**
   * Optional health signals (Track-Signals, migration 010). Each field is
   * present only when the user has data for it; the prompt-input formatter
   * drops keys that are null so the prompt cache stays stable for users with
   * no signals enabled.
   */
  glucose_today: GlucoseTodaySignal | null;
  blood_markers_recent: BloodMarkersSignal | null;
  cycle_today: CycleTodaySignal | null;
  /**
   * Sync freshness summary (Track 7). Lets the coach disclose stale data and
   * default to conservative recommendations rather than confidently building
   * on a 4-day-old HRV reading. Always present; populated even when all
   * biometrics are missing (in which case `primary_source` is null and the
   * coach falls through to BIOMETRICS_MISSING heuristics).
   */
  data_freshness: DataFreshness;
  /**
   * Track 10 — anomalies in today's biometrics vs the user's own 28-day
   * baseline. Empty array when nothing exceeds the z-threshold or when there
   * isn't enough history to call an anomaly. The coach uses these to lead
   * the recovery note ("Your HRV is unusually low for you…").
   */
  anomalies: AnomalySignal[];
  /**
   * Track 12 — top-k semantically-similar past chat turns and briefings,
   * retrieved via cosine similarity over OpenAI text-embedding-3-small.
   * Empty array when no past memory crosses the similarity threshold or for
   * brand-new users whose history hasn't been embedded yet.
   */
  recall: Recollection[];
  /**
   * Track 13 — actionable genome SNPs for the user (caffeine metabolism,
   * lactose persistence, ACTN3 power-vs-endurance, COMT, etc.). Empty array
   * when no genome data has been uploaded.
   */
  genome_flags: GenomeFlag[];
}

export interface DataFreshness {
  /**
   * Priority winner for today's biometrics_today row, if any data exists for
   * today. Null when there is no row for today across any source — i.e. a
   * cold-start day where the user hasn't synced.
   */
  primary_source: BiometricsSource | null;
  /** Hours since the most recent non-null hrv_ms reading across any source. */
  hrv_age_hours: number | null;
  /** Hours since the most recent non-null sleep_score reading across any source. */
  sleep_score_age_hours: number | null;
  /** True if any tracked metric (hrv, sleep_score) is more than 36h old. */
  any_stale: boolean;
  /** Sources with >=3 error rows in the audit_ledger over the last 24h. */
  recently_errored: BiometricsSource[];
}

export interface GlucoseTodaySignal {
  /** Most recent fasting reading mg/dL in the last 24h, if tagged. */
  fasting: number | null;
  /** Average post-meal mg/dL in the last 24h, if any. */
  post_meal_avg: number | null;
  /** % of last-24h readings between 70 and 140 mg/dL. */
  time_in_range_pct: number | null;
  /** Most recent reading mg/dL (any context). */
  latest: number | null;
  /** Number of readings used. Helps the coach calibrate confidence. */
  reading_count: number;
}

export interface BloodMarkerKeySnapshot {
  value: number;
  unit: string;
  flag: BloodMarkerFlag | null;
}

export interface BloodMarkersSignal {
  panel_date: string;
  lab: string;
  /**
   * Subset of curated coaching markers if present on the panel. Keys absent
   * when the user didn't record that marker.
   */
  key_markers: Partial<Record<KeyMarkerName, BloodMarkerKeySnapshot>>;
}

export type KeyMarkerName =
  | 'ldl'
  | 'hdl'
  | 'apoB'
  | 'hsCRP'
  | 'hbA1c';

export interface CycleTodaySignal {
  day_of_cycle: number;
  phase: CyclePhase;
  days_until_next: number | null;
}

export type WorkoutKind = 'lift' | 'run' | 'rest' | 'other';

export interface RecentWorkoutsSummary {
  days_with_workouts: number;
  last_lift_day: string | null;
  last_run_day: string | null;
  last_rest_day: string | null;
  avg_duration_minutes: number;
  /** e.g. "lift / run / rest / lift / run / rest / lift" — most recent on the right. */
  workout_pattern: string;
}

export interface RecentMealsSummary {
  avg_kcal_per_briefing: number;
  avg_protein_g: number;
  avg_fiber_g: number;
  notes: string;
}

export interface MacroAggregate {
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber: number;
  by_meal: Record<string, { kcal: number; p: number; c: number; f: number }>;
}

/** Trim of `biometrics_daily` used only by the freshness summary. */
interface BiometricsPerSourceLite {
  date: string;
  source: BiometricsSource;
  fetched_at: string;
  hrv_ms: number | null;
  sleep_score: number | null;
}

/** Trim of `audit_ledger` used only by the freshness summary. */
interface AuditLedgerLite {
  action: string;
  status: string;
  ts: string;
}

const STALE_THRESHOLD_HOURS = 36;
const ERROR_BURST_COUNT = 3;

/**
 * Compute the data_freshness summary from the per-source biometric rows and
 * sync errors in the last 24h.
 *
 * - `primary_source`: the source winning today's merged row (if any).
 * - `hrv_age_hours` / `sleep_score_age_hours`: hours since the most recent
 *   non-null reading across any source. Falls back to the `fetched_at` of
 *   that row, since that's the closest proxy to "when did this land".
 * - `any_stale`: true if either tracked metric is older than 36h. Today's
 *   row is always fresh-by-definition since fetched_at is "now-ish".
 * - `recently_errored`: per-source sync action that failed >=3 times in the
 *   last 24h (e.g. `sync.whoop` x4 → `['whoop']`).
 */
function computeDataFreshness(
  perSourceRows: BiometricsPerSourceLite[],
  errorRows: AuditLedgerLite[],
  todayRow: BiometricsDaily | null,
  todayISODate: string,
  now: Date
): DataFreshness {
  const nowMs = now.getTime();

  // primary_source: only set if today's merged row actually represents today.
  // (biometrics_today falls back to yesterday when today is missing — we do
  // NOT call that "primary today".)
  const primary_source: BiometricsSource | null =
    todayRow && todayRow.date === todayISODate
      ? (todayRow.source as BiometricsSource)
      : null;

  function ageHoursForMetric(
    field: 'hrv_ms' | 'sleep_score'
  ): number | null {
    let bestMs: number | null = null;
    for (const row of perSourceRows) {
      const v = row[field];
      if (v === null || v === undefined) continue;
      const t = Date.parse(row.fetched_at);
      if (!Number.isFinite(t)) continue;
      if (bestMs === null || t > bestMs) bestMs = t;
    }
    if (bestMs === null) return null;
    return Math.max(0, Math.round(((nowMs - bestMs) / 36e5) * 10) / 10);
  }

  const hrv_age_hours = ageHoursForMetric('hrv_ms');
  const sleep_score_age_hours = ageHoursForMetric('sleep_score');

  // any_stale: missing data also counts as stale (the coach should disclose).
  const stale = (h: number | null) =>
    h === null || h > STALE_THRESHOLD_HOURS;
  const any_stale = stale(hrv_age_hours) || stale(sleep_score_age_hours);

  // recently_errored: count error rows per source action, flag any >= 3.
  const errorCounts = new Map<string, number>();
  for (const row of errorRows) {
    // action like "sync.garmin" → source = "garmin". Skip oddball actions.
    if (!row.action.startsWith('sync.')) continue;
    const source = row.action.slice('sync.'.length);
    if (!source) continue;
    errorCounts.set(source, (errorCounts.get(source) ?? 0) + 1);
  }
  const recently_errored: BiometricsSource[] = [];
  const validSources: BiometricsSource[] = ['garmin', 'whoop', 'apple_watch', 'manual'];
  for (const [src, count] of errorCounts) {
    if (count < ERROR_BURST_COUNT) continue;
    if ((validSources as string[]).includes(src)) {
      recently_errored.push(src as BiometricsSource);
    }
  }
  recently_errored.sort();

  return {
    primary_source,
    hrv_age_hours,
    sleep_score_age_hours,
    any_stale,
    recently_errored,
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Trend tag thresholds: ±5% delta of avg(last 3 days) vs avg(prior 4 days)
 * counts as `stable`. Beyond ±5% is `improving`/`declining`. The polarity
 * differs by metric (higher HRV is good, lower RHR is good) — encoded below.
 *
 * Returns 'unknown' when either window has fewer than 2 datapoints, since a
 * single-row average is too noisy to call a trend.
 */
const TREND_THRESHOLD = 0.05;

function computeTrend(
  recent: number[],
  prior: number[],
  higherIsBetter: boolean
): TrendTag {
  if (recent.length < 2 || prior.length < 2) return 'unknown';
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const r = avg(recent);
  const p = avg(prior);
  if (p === 0) return 'unknown';
  const delta = (r - p) / p;
  if (Math.abs(delta) < TREND_THRESHOLD) return 'stable';
  if (higherIsBetter) return delta > 0 ? 'improving' : 'declining';
  return delta < 0 ? 'improving' : 'declining';
}

function pickNumeric(
  rows: BiometricsDaily[],
  key: keyof BiometricsDaily
): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = row[key];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Classify a workout as lift / run / rest / other based on case-insensitive
 * substring matches over the workout name AND every block name. The order
 * below is intentional: a "rest" / "active recovery" tag wins over running or
 * lifting cues, which can both show up as accessory blocks on a recovery day.
 */
export function classifyWorkout(
  workout: BriefingWorkoutLite | null | undefined
): WorkoutKind {
  if (!workout) return 'rest';
  const haystack = [
    workout.name ?? '',
    ...((workout.blocks ?? []).map((b) => b?.name ?? '')),
  ]
    .join(' ')
    .toLowerCase();

  if (!haystack.trim()) return 'other';

  if (
    haystack.includes('rest') ||
    haystack.includes('active recovery') ||
    haystack.includes('recovery day')
  ) {
    return 'rest';
  }

  const runCues = ['run', 'interval', 'tempo', '5k', 'z2', 'easy cardio', 'jog'];
  if (runCues.some((cue) => haystack.includes(cue))) {
    return 'run';
  }

  const liftCues = [
    'lift',
    'push',
    'pull',
    'legs',
    'upper',
    'lower',
    'hypertrophy',
    'strength',
    'squat',
    'bench',
    'deadlift',
  ];
  if (liftCues.some((cue) => haystack.includes(cue))) {
    return 'lift';
  }

  return 'other';
}

interface BriefingWorkoutLite {
  name?: string;
  duration_minutes?: number | null;
  blocks?: Array<{ name?: string } | null | undefined> | null;
}

function summarizeRecentWorkouts(
  briefings: DailyBriefing[]
): RecentWorkoutsSummary {
  if (briefings.length === 0) {
    return {
      days_with_workouts: 0,
      last_lift_day: null,
      last_run_day: null,
      last_rest_day: null,
      avg_duration_minutes: 0,
      workout_pattern: '',
    };
  }

  let last_lift_day: string | null = null;
  let last_run_day: string | null = null;
  let last_rest_day: string | null = null;
  let durationSum = 0;
  let durationCount = 0;
  let daysWithWorkouts = 0;

  // Briefings are ordered most-recent first; reverse for the pattern so the
  // resulting string reads oldest → newest left to right.
  const oldestFirst = [...briefings].reverse();
  const patternParts: string[] = [];

  for (const b of oldestFirst) {
    const w = b.workout as BriefingWorkoutLite | null | undefined;
    const kind = classifyWorkout(w);
    patternParts.push(kind);

    if (kind !== 'rest' && w) daysWithWorkouts += 1;

    if (w && typeof w.duration_minutes === 'number' && Number.isFinite(w.duration_minutes)) {
      durationSum += w.duration_minutes;
      durationCount += 1;
    }
  }

  // Walk most-recent → oldest to capture the most-recent day for each kind.
  for (const b of briefings) {
    const w = b.workout as BriefingWorkoutLite | null | undefined;
    const kind = classifyWorkout(w);
    if (kind === 'lift' && !last_lift_day) last_lift_day = b.date;
    if (kind === 'run' && !last_run_day) last_run_day = b.date;
    if (kind === 'rest' && !last_rest_day) last_rest_day = b.date;
  }

  return {
    days_with_workouts: daysWithWorkouts,
    last_lift_day,
    last_run_day,
    last_rest_day,
    avg_duration_minutes:
      durationCount === 0 ? 0 : Math.round(durationSum / durationCount),
    workout_pattern: patternParts.join(' / '),
  };
}

function summarizeRecentMeals(
  briefings: DailyBriefing[]
): RecentMealsSummary {
  if (briefings.length === 0) {
    return {
      avg_kcal_per_briefing: 0,
      avg_protein_g: 0,
      avg_fiber_g: 0,
      notes: '',
    };
  }

  let kcalSum = 0;
  let proteinSum = 0;
  // Briefing meals don't carry fiber on `BriefingMacros`; we expose a 0 average
  // here rather than inventing a number, until/unless the meal schema gains
  // fiber. Keeps the field present so the prompt has a stable shape.
  const fiberSum = 0;
  let kcalCount = 0;

  for (const b of briefings) {
    const meals = Array.isArray(b.meals) ? b.meals : [];
    let dayKcal = 0;
    let dayProtein = 0;
    for (const m of meals) {
      if (!m?.macros) continue;
      dayKcal += m.macros.kcal ?? 0;
      dayProtein += m.macros.p ?? 0;
    }
    if (meals.length > 0) {
      kcalSum += dayKcal;
      proteinSum += dayProtein;
      kcalCount += 1;
    }
  }

  return {
    avg_kcal_per_briefing: kcalCount === 0 ? 0 : Math.round(kcalSum / kcalCount),
    avg_protein_g: kcalCount === 0 ? 0 : Math.round(proteinSum / kcalCount),
    avg_fiber_g: kcalCount === 0 ? 0 : Math.round(fiberSum / kcalCount),
    notes: '',
  };
}

function computeAgeYears(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 && age < 130 ? age : null;
}

export interface AssembleCoachContextOpts {
  /**
   * Override the recall query used to retrieve semantic memory. Defaults to a
   * synthesized summary of today's biometric snapshot — which is right for the
   * briefing endpoint. Chat callers should pass the latest user turn.
   */
  recallQuery?: string;
}

export async function assembleCoachContext(
  userId: string,
  opts: AssembleCoachContextOpts = {}
): Promise<CoachContext> {
  const supabase = await createClient();
  const today = todayISO();
  const yesterday = yesterdayISO();
  const dayOfWeek = new Date(today).getDay(); // 0=Sun..6=Sat — daily_goals uses 0=any-day

  // Profile
  const { data: profile } = await supabase
    .from('user_profile')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  // Biometrics — pull last 8 rows (today + 7-day baseline) so we can compute
  // both today's snapshot and the trend tags from a single query.
  //
  // Read from the merged view (migration 013): each row already represents the
  // priority-winning value per metric for that day, so multi-source users
  // (Garmin + Whoop + Apple Watch) get the right HRV/sleep without us doing
  // the merge in TypeScript. Writes still go to the underlying table.
  //
  // Track 7: in parallel with the merged read, we also pull (a) the same
  // 7-day window from the per-source `biometrics_daily` table — needed to
  // compute per-metric age + per-source last-synced — and (b) the last 24h
  // of `audit_ledger` sync errors so we know which sources are flapping.
  // Three queries in parallel = same wall-clock cost as the previous single
  // biometric query.
  const baselineFloor = isoNDaysAgo(7);
  const since24hISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [bioMergedRes, bioPerSourceRes, syncErrorsRes] = await Promise.all([
    supabase
      .from('biometrics_daily_merged')
      .select('*')
      .eq('user_id', userId)
      .gte('date', baselineFloor)
      .order('date', { ascending: false }),
    supabase
      .from('biometrics_daily')
      .select('date, source, fetched_at, hrv_ms, sleep_score')
      .eq('user_id', userId)
      .gte('date', baselineFloor)
      .order('date', { ascending: false }),
    supabase
      .from('audit_ledger')
      .select('action, status, ts')
      .eq('user_id', userId)
      .eq('status', 'error')
      .like('action', 'sync.%')
      .gte('ts', since24hISO),
  ]);

  const allBio = (bioMergedRes.data ?? []) as BiometricsDaily[];
  const perSourceRows = (bioPerSourceRes.data ?? []) as BiometricsPerSourceLite[];
  const errorRows = (syncErrorsRes.data ?? []) as AuditLedgerLite[];

  const biometrics_today =
    allBio.find((r) => r.date === today) ??
    allBio.find((r) => r.date === yesterday) ??
    null;

  // Last 3 full days = yesterday, -2, -3. (Today's row is excluded because
  // it's often partial mid-day; we want completed days for trend math.)
  const last3Floor = isoNDaysAgo(3);
  const biometrics_last_3_days = allBio
    .filter((r) => r.date >= last3Floor && r.date < today)
    .slice(0, 3);

  // Trend tags: compare avg(last 3 days, days t-3..t-1) vs avg(prior 4 days, t-7..t-4).
  const priorFloor = isoNDaysAgo(7);
  const priorCeil = isoNDaysAgo(4);
  const biometrics_prior_4_days = allBio.filter(
    (r) => r.date >= priorFloor && r.date <= priorCeil
  );

  const trends: BiometricTrends = {
    sleep_trend: computeTrend(
      pickNumeric(biometrics_last_3_days, 'sleep_score'),
      pickNumeric(biometrics_prior_4_days, 'sleep_score'),
      true
    ),
    hrv_trend: computeTrend(
      pickNumeric(biometrics_last_3_days, 'hrv_ms'),
      pickNumeric(biometrics_prior_4_days, 'hrv_ms'),
      true
    ),
    rhr_trend: computeTrend(
      pickNumeric(biometrics_last_3_days, 'resting_hr'),
      pickNumeric(biometrics_prior_4_days, 'resting_hr'),
      false
    ),
    training_load_trend: computeTrend(
      pickNumeric(biometrics_last_3_days, 'training_load_acute'),
      pickNumeric(biometrics_prior_4_days, 'training_load_acute'),
      true
    ),
  };

  // Goal — try today's day_of_week first, fall back to default (day_of_week=0)
  const { data: goalRows } = await supabase
    .from('daily_goals')
    .select('*')
    .eq('user_id', userId)
    .in('day_of_week', [dayOfWeek, 0]);

  const goal_today =
    (goalRows ?? []).find((g) => g.day_of_week === dayOfWeek) ??
    (goalRows ?? []).find((g) => g.day_of_week === 0) ??
    null;

  // Last 24h of diary entries — joined to foods + recipes for macro aggregation
  const { data: diaryRows } = await supabase
    .from('diary_entries')
    .select(
      'id, date, meal_type, number_of_servings, food:foods(*), recipe:recipes(*, ingredients:recipe_ingredients(*, food:foods(*)))'
    )
    .eq('user_id', userId)
    .eq('date', today)
    .is('deleted_at', null);

  const macros_today = aggregateMacros((diaryRows ?? []) as unknown as DiaryEntry[]);

  // Last 7 days of briefings — covers yesterday_workout + the new
  // recent_history summaries in one round-trip. Floor is t-7 so we get up to
  // 7 prior days plus today (today is harmless if present).
  const briefingFloor = isoNDaysAgo(7);
  const { data: briefingRows } = await supabase
    .from('daily_briefing')
    .select('*')
    .eq('user_id', userId)
    .gte('date', briefingFloor)
    .order('date', { ascending: false })
    .limit(8);

  const briefings_last_7d = ((briefingRows ?? []) as DailyBriefing[])
    .filter((b) => b.date < today)
    .slice(0, 7);

  const yesterday_workout =
    (briefings_last_7d.find((b) => b.date === yesterday)
      ?.workout as DailyBriefing['workout']) ?? null;

  const recent_workouts_summary = summarizeRecentWorkouts(briefings_last_7d);
  const recent_meals_summary = summarizeRecentMeals(briefings_last_7d);

  const profileTyped = (profile ?? null) as UserProfile | null;
  const age_years = computeAgeYears(profileTyped?.dob ?? null);

  // ---------------- Optional signals (migration 010) -------------------------
  // These tables are opt-in; the cheapest path is to fan out three small
  // queries in parallel and let the summarizers downgrade to null when the
  // user has no data. We do NOT short-circuit on profile.gender here — the
  // /settings page hides the cycle card by default for non-female/nonbinary
  // users, but the coach respects whatever rows actually exist.

  // Glucose: last 24h.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: glucoseRows } = await supabase
    .from('glucose_readings')
    .select('*')
    .gte('recorded_at', since24h)
    .order('recorded_at', { ascending: false })
    .limit(500);

  const glucose_today = summarizeGlucose((glucoseRows ?? []) as GlucoseReading[]);

  // Most recent blood panel + readings.
  const { data: panelRow } = await supabase
    .from('blood_panels')
    .select('*, readings:blood_marker_readings(*)')
    .order('panel_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const blood_markers_recent = panelRow
    ? summarizeBloodPanel(panelRow as BloodPanel)
    : null;

  // Cycle: last 6 logged starts → phase if user is female/nonbinary AND has data.
  const { data: cycleRows } = await supabase
    .from('cycle_entries')
    .select('*')
    .order('start_date', { ascending: false })
    .limit(6);

  const cycle_today = summarizeCycle(
    (cycleRows ?? []) as CycleEntry[],
    profileTyped?.gender ?? null
  );

  const data_freshness = computeDataFreshness(
    perSourceRows,
    errorRows,
    biometrics_today,
    today,
    new Date()
  );

  // Track 10/12/13: anomaly + memory + genome run in parallel after the
  // biometrics history has loaded. None block the others; failures are
  // caught individually so a flaky embedding API can never sink the whole
  // briefing.
  const recallQuery =
    opts.recallQuery ?? buildDefaultRecallQuery(biometrics_today, trends);

  const [anomalies, recall, genome_flags] = await Promise.all([
    Promise.resolve(
      computeAnomalies({
        history: [...allBio].reverse(), // assembleCoachContext keeps allBio newest-first; computeAnomalies wants oldest-first
        today,
      })
    ),
    recallRelevant({ userId, query: recallQuery }).catch((err) => {
      console.error('[coach/context] recallRelevant failed', err);
      return [] as Recollection[];
    }),
    relevantGenomeFlags({ userId }).catch((err) => {
      console.error('[coach/context] relevantGenomeFlags failed', err);
      return [] as GenomeFlag[];
    }),
  ]);

  return {
    user_id: userId,
    today,
    profile: profileTyped,
    biometrics_today,
    biometrics_last_3_days,
    biometrics_baseline_7d: allBio,
    trends,
    age_years,
    goal_today: goal_today as DailyGoal | null,
    macros_today,
    yesterday_workout,
    briefings_last_7d,
    recent_workouts_summary,
    recent_meals_summary,
    glucose_today,
    blood_markers_recent,
    cycle_today,
    data_freshness,
    anomalies,
    recall,
    genome_flags,
  };
}

/**
 * Synthesizes a recall query for the briefing endpoint. The shape mirrors
 * what a coach would ask another coach: "what was going on the last time
 * the user looked like this?". Chat callers override this with the latest
 * user turn.
 */
function buildDefaultRecallQuery(
  bio: BiometricsDaily | null,
  trends: BiometricTrends
): string {
  const parts: string[] = [];
  if (bio) {
    if (bio.sleep_score !== null) parts.push(`sleep score ${bio.sleep_score}`);
    if (bio.hrv_ms !== null) parts.push(`HRV ${bio.hrv_ms}ms`);
    if (bio.resting_hr !== null) parts.push(`resting HR ${bio.resting_hr}`);
    if (bio.training_load_acute !== null)
      parts.push(`training load ${bio.training_load_acute}`);
  }
  parts.push(`HRV trend ${trends.hrv_trend}`);
  parts.push(`sleep trend ${trends.sleep_trend}`);
  return `Coach query — today's state: ${parts.join(', ')}`;
}

// ============================================================
// Optional-signal summarizers (migration 010)
// ============================================================

const TIR_LOW = 70;
const TIR_HIGH = 140;

function summarizeGlucose(rows: GlucoseReading[]): GlucoseTodaySignal | null {
  if (rows.length === 0) return null;

  // rows ordered most-recent first, newest -> oldest.
  const latest = rows[0]?.mg_dl ?? null;

  let fasting: number | null = null;
  for (const r of rows) {
    if (r.context === 'fasting') {
      fasting = r.mg_dl;
      break;
    }
  }

  const postMeal = rows.filter((r) => r.context === 'post_meal');
  const post_meal_avg =
    postMeal.length === 0
      ? null
      : Math.round(postMeal.reduce((a, b) => a + b.mg_dl, 0) / postMeal.length);

  const inRange = rows.filter(
    (r) => r.mg_dl >= TIR_LOW && r.mg_dl <= TIR_HIGH
  ).length;
  const time_in_range_pct = Math.round((inRange / rows.length) * 100);

  return {
    fasting,
    post_meal_avg,
    time_in_range_pct,
    latest,
    reading_count: rows.length,
  };
}

const KEY_MARKERS: KeyMarkerName[] = ['ldl', 'hdl', 'apoB', 'hsCRP', 'hbA1c'];

/**
 * Markers in the wild come back from Claude's parser and from manual entry
 * with case variability — match liberally on lowercase + de-underscored
 * forms so apoB, ApoB, apo_b, APOB all collapse to the canonical key.
 */
function normalizeMarkerKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}
const KEY_MARKER_NORMS: Record<string, KeyMarkerName> = {
  ldl: 'ldl',
  hdl: 'hdl',
  apob: 'apoB',
  hscrp: 'hsCRP',
  hba1c: 'hbA1c',
};

function summarizeBloodPanel(panel: BloodPanel): BloodMarkersSignal {
  const out: Partial<Record<KeyMarkerName, BloodMarkerKeySnapshot>> = {};
  const readings = panel.readings ?? [];
  for (const r of readings as BloodMarkerReading[]) {
    const norm = normalizeMarkerKey(r.marker);
    const key = KEY_MARKER_NORMS[norm];
    if (!key) continue;
    // First occurrence wins — panels typically don't repeat a marker.
    if (out[key]) continue;
    out[key] = {
      value: r.value,
      unit: r.unit,
      flag: r.flag,
    };
  }
  return {
    panel_date: panel.panel_date,
    lab: panel.lab ?? '',
    key_markers: out,
  };
}

function summarizeCycle(
  entries: CycleEntry[],
  gender: UserProfile['gender'] | null
): CycleTodaySignal | null {
  if (entries.length === 0) return null;
  // Cycle logic only personalizes for users who've identified as female /
  // nonbinary. Other users with stale entries shouldn't get cycle-shaped
  // recommendations.
  if (gender !== 'female' && gender !== 'nonbinary') return null;

  const result = computeCyclePhase(entries, new Date());
  if (result.phase === 'unknown') return null;
  return {
    day_of_cycle: result.day_of_cycle,
    phase: result.phase,
    days_until_next: result.days_until_next,
  };
}
// Suppress KEY_MARKERS-unused warning; exported for prompt-side reference.
void KEY_MARKERS;

function aggregateMacros(entries: DiaryEntry[]): MacroAggregate {
  const total = { kcal: 0, p: 0, c: 0, f: 0, fiber: 0 };
  const by_meal: Record<string, { kcal: number; p: number; c: number; f: number }> = {};

  for (const entry of entries) {
    const meal = entry.meal_type;
    if (!by_meal[meal]) by_meal[meal] = { kcal: 0, p: 0, c: 0, f: 0 };

    const servings = entry.number_of_servings;

    if (entry.food) {
      const f = entry.food;
      total.kcal += f.calories * servings;
      total.p += f.protein * servings;
      total.c += f.carbs * servings;
      total.f += f.fat * servings;
      total.fiber += f.fiber * servings;
      by_meal[meal].kcal += f.calories * servings;
      by_meal[meal].p += f.protein * servings;
      by_meal[meal].c += f.carbs * servings;
      by_meal[meal].f += f.fat * servings;
    } else if (entry.recipe?.ingredients) {
      const r = entry.recipe;
      const perServing = sumRecipe(r);
      total.kcal += perServing.kcal * servings;
      total.p += perServing.p * servings;
      total.c += perServing.c * servings;
      total.f += perServing.f * servings;
      total.fiber += perServing.fiber * servings;
      by_meal[meal].kcal += perServing.kcal * servings;
      by_meal[meal].p += perServing.p * servings;
      by_meal[meal].c += perServing.c * servings;
      by_meal[meal].f += perServing.f * servings;
    }
  }

  return { ...total, by_meal };
}

function sumRecipe(recipe: Recipe): { kcal: number; p: number; c: number; f: number; fiber: number } {
  const total = { kcal: 0, p: 0, c: 0, f: 0, fiber: 0 };
  if (!recipe.ingredients) return total;
  for (const ing of recipe.ingredients) {
    if (!ing.food) continue;
    const f: Food = ing.food;
    const q = ing.quantity;
    total.kcal += f.calories * q;
    total.p += f.protein * q;
    total.c += f.carbs * q;
    total.f += f.fat * q;
    total.fiber += f.fiber * q;
  }
  const servings = Math.max(recipe.servings, 1);
  return {
    kcal: total.kcal / servings,
    p: total.p / servings,
    c: total.c / servings,
    f: total.f / servings,
    fiber: total.fiber / servings,
  };
}

/**
 * Compact JSON shape sent to Claude as the per-request user message. Kept
 * deliberately small so the daily-state portion of the prompt stays cheap to
 * send (the system prompt + profile are cached separately).
 *
 * Includes: today's biometrics, the 3-day-trend tags, basic demographic
 * coaching context (age, gender, training_experience), the user's
 * genome_traits as freeform JSON, and a static dict of Bryan Johnson Blueprint
 * targets the prompt can reference for specific recommendations.
 */
export function contextToPromptInput(ctx: CoachContext): string {
  const profile = ctx.profile;
  return JSON.stringify(
    {
      date: ctx.today,
      day_of_week: new Date(ctx.today).toLocaleString('en-US', { weekday: 'long' }),
      demographics: {
        age_years: ctx.age_years,
        gender: profile?.gender ?? null,
        height_cm: profile?.height_cm ?? null,
        weight_kg: profile?.weight_kg ?? null,
        training_experience: profile?.training_experience ?? null,
      },
      biometrics: ctx.biometrics_today
        ? {
            sleep_score: ctx.biometrics_today.sleep_score,
            sleep_duration_minutes: ctx.biometrics_today.sleep_duration_minutes,
            hrv_ms: ctx.biometrics_today.hrv_ms,
            resting_hr: ctx.biometrics_today.resting_hr,
            stress_avg: ctx.biometrics_today.stress_avg,
            training_load_acute: ctx.biometrics_today.training_load_acute,
            training_load_chronic: ctx.biometrics_today.training_load_chronic,
            total_steps: ctx.biometrics_today.total_steps,
            vigorous_minutes: ctx.biometrics_today.vigorous_minutes,
            moderate_minutes: ctx.biometrics_today.moderate_minutes,
            deep_sleep_minutes: ctx.biometrics_today.deep_sleep_minutes,
            rem_sleep_minutes: ctx.biometrics_today.rem_sleep_minutes,
            vo2max: ctx.biometrics_today.vo2max,
            source: ctx.biometrics_today.source,
            data_date: ctx.biometrics_today.date,
          }
        : null,
      biometrics_last_3_days: ctx.biometrics_last_3_days.map((r) => ({
        date: r.date,
        sleep_score: r.sleep_score,
        hrv_ms: r.hrv_ms,
        resting_hr: r.resting_hr,
        training_load_acute: r.training_load_acute,
        total_steps: r.total_steps,
      })),
      trends: ctx.trends,
      goal: ctx.goal_today
        ? {
            kcal: ctx.goal_today.calories,
            p: ctx.goal_today.protein,
            c: ctx.goal_today.carbs,
            f: ctx.goal_today.fat,
            fiber: ctx.goal_today.fiber,
          }
        : null,
      macros_logged_today: {
        kcal: round1(ctx.macros_today.kcal),
        p: round1(ctx.macros_today.p),
        c: round1(ctx.macros_today.c),
        f: round1(ctx.macros_today.f),
        fiber: round1(ctx.macros_today.fiber),
      },
      yesterday_workout: ctx.yesterday_workout ?? null,
      recent_history: {
        workouts: ctx.recent_workouts_summary,
        meals: ctx.recent_meals_summary,
        last_3_briefings: ctx.briefings_last_7d.slice(0, 3).map((b) => ({
          date: b.date,
          workout_name: b.workout?.name ?? null,
          recovery_note_first_sentence: firstSentence(b.recovery_note),
        })),
      },
      // Track K populates this. {} when no genome data uploaded yet.
      genome_traits: profile?.genome_traits ?? {},
      // Optional signals (migration 010). Only includes keys with data so the
      // prompt cache stays stable for users who haven't enabled any of them.
      ...(buildOptionalSignals(ctx) ?? {}),
      // Track 7: per-metric data freshness + recently-errored sync sources.
      // The coach uses this to disclose stale data and default to conservative
      // recommendations rather than confidently building on a 4-day-old HRV.
      data_freshness: {
        primary_source: ctx.data_freshness.primary_source,
        hrv_age_hours: ctx.data_freshness.hrv_age_hours,
        sleep_score_age_hours: ctx.data_freshness.sleep_score_age_hours,
        any_stale: ctx.data_freshness.any_stale,
        recently_errored: ctx.data_freshness.recently_errored,
      },
      // Track 10: anomaly signals over the user's own 28-day baseline.
      // Empty array stays in the payload as `[]` so the prompt cache shape
      // is stable; the prompt itself decides whether to lead with them.
      anomalies: ctx.anomalies.map((a) => ({
        metric: a.metric_label,
        today: a.today_value,
        baseline_median: a.baseline_median,
        z_score: round1(a.z_score),
        direction: a.direction,
        severity: a.severity,
        similar_past: a.similar_past.map((p) => ({
          date: p.date,
          value: p.value,
          z_score: round1(p.z_score),
        })),
      })),
      // Track 12: top-k semantically-similar past coach turns / briefings.
      // Each entry already has age_days and similarity attached. The prompt
      // can quote these verbatim back to the user ("on 04/12 you mentioned…").
      past_context: ctx.recall.map((r) => ({
        ts: r.ts,
        age_days: r.age_days,
        source: r.source_type,
        similarity: round2(r.similarity),
        excerpt: r.content.length > 360 ? r.content.slice(0, 357) + '...' : r.content,
      })),
      // Track 13: actionable SNP flags. These supersede the coarse
      // genome_traits dict above for any category they cover (caffeine,
      // lactose, ACTN3, COMT, etc.) — the prompt is told to prefer them.
      genome_flags: ctx.genome_flags.map((g) => ({
        category: g.category,
        label: g.label,
        rsid: g.rsid,
        genotype: g.genotype,
        interpretation: g.interpretation,
        confidence: g.confidence,
        actionable_in: g.actionable_in,
      })),
      blueprint_references: BLUEPRINT_REFERENCES,
    },
    null,
    0
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Builds the `optional_signals` block. Returns null when the user has no
 * data on any of the three opt-in surfaces, so the prompt input doesn't
 * grow a `optional_signals: {}` key for empty users (cache stability).
 *
 * Each sub-key is included only when the underlying summarizer produced a
 * non-null payload, and inside each, null fields are stripped (the spec
 * explicitly says "never include null fields").
 */
function buildOptionalSignals(
  ctx: CoachContext
): { optional_signals: Record<string, unknown> } | null {
  const signals: Record<string, unknown> = {};

  if (ctx.glucose_today) {
    const g: Record<string, unknown> = {};
    if (ctx.glucose_today.fasting !== null) g.fasting = ctx.glucose_today.fasting;
    if (ctx.glucose_today.post_meal_avg !== null)
      g.post_meal_avg = ctx.glucose_today.post_meal_avg;
    if (ctx.glucose_today.time_in_range_pct !== null)
      g.time_in_range_pct = ctx.glucose_today.time_in_range_pct;
    if (ctx.glucose_today.latest !== null) g.latest = ctx.glucose_today.latest;
    if (Object.keys(g).length > 0) {
      g.reading_count = ctx.glucose_today.reading_count;
      signals.glucose = g;
    }
  }

  if (ctx.blood_markers_recent) {
    const km = ctx.blood_markers_recent.key_markers;
    const kmOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(km)) {
      if (!v) continue;
      const entry: Record<string, unknown> = { value: v.value, unit: v.unit };
      if (v.flag) entry.flag = v.flag;
      kmOut[k] = entry;
    }
    if (Object.keys(kmOut).length > 0) {
      signals.blood = {
        panel_date: ctx.blood_markers_recent.panel_date,
        ...(ctx.blood_markers_recent.lab
          ? { lab: ctx.blood_markers_recent.lab }
          : {}),
        key_markers: kmOut,
      };
    }
  }

  if (ctx.cycle_today) {
    const c: Record<string, unknown> = {
      phase: ctx.cycle_today.phase,
      day_of_cycle: ctx.cycle_today.day_of_cycle,
    };
    if (ctx.cycle_today.days_until_next !== null) {
      c.days_until_next = ctx.cycle_today.days_until_next;
    }
    signals.cycle = c;
  }

  if (Object.keys(signals).length === 0) return null;
  return { optional_signals: signals };
}

/**
 * Static dict of Bryan Johnson "do-not-die" Blueprint daily targets the
 * coaching prompt anchors recommendations against. Specific numbers beat
 * generic adjectives in the briefing — this gives Claude defaults to cite
 * when the user has no other clear target.
 */
export const BLUEPRINT_REFERENCES = {
  sleep_hours_min: 7,
  sleep_deep_plus_rem_minutes_min: 90,
  sleep_score_target: 80,
  hrv_direction: 'stable_or_up',
  rhr_athletic_max: 60,
  rhr_well_trained_max: 50,
  vo2max_target: 'above_average_for_age',
  steps_floor: 8000,
  steps_target: 10000,
  steps_movement_heavy_day: 12000,
  zone2_minutes_per_week: 90, // 1-2h
  vigorous_minutes_per_week: 75,
  vigorous_minutes_per_day_blueprint: 30,
  protein_g_per_lb_bodyweight: 1.0,
  fiber_g_per_day: 30,
  fiber_g_per_day_target: 40,
  polyphenol_colors_per_day: 6,
  omega3_g_per_day: 2,
  caffeine_rule: 'morning_only_if_CYP1A2_fast',
} as const;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** First sentence of a paragraph, capped at ~140 chars to keep the user
 *  message tight. Returns '' for null/empty input. */
function firstSentence(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  // End at the first sentence terminator that's followed by whitespace or EOL.
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  const out = match ? match[0] : trimmed;
  return out.length > 140 ? out.slice(0, 137) + '...' : out;
}
