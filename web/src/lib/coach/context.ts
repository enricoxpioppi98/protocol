import { createClient } from '@/lib/supabase/server';
import type {
  BiometricsDaily,
  DailyBriefing,
  DailyGoal,
  DiaryEntry,
  Food,
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
}

export interface MacroAggregate {
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber: number;
  by_meal: Record<string, { kcal: number; p: number; c: number; f: number }>;
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

export async function assembleCoachContext(userId: string): Promise<CoachContext> {
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
  const baselineFloor = isoNDaysAgo(7);
  const { data: bioRows } = await supabase
    .from('biometrics_daily')
    .select('*')
    .eq('user_id', userId)
    .gte('date', baselineFloor)
    .order('date', { ascending: false });

  const allBio = (bioRows ?? []) as BiometricsDaily[];

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

  // Yesterday's workout — for periodization continuity
  const { data: yesterdayBriefing } = await supabase
    .from('daily_briefing')
    .select('workout')
    .eq('user_id', userId)
    .eq('date', yesterday)
    .maybeSingle();

  const profileTyped = (profile ?? null) as UserProfile | null;
  const age_years = computeAgeYears(profileTyped?.dob ?? null);

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
    yesterday_workout: (yesterdayBriefing?.workout as DailyBriefing['workout']) ?? null,
  };
}

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
      // Track K populates this. {} when no genome data uploaded yet.
      genome_traits: profile?.genome_traits ?? {},
      blueprint_references: BLUEPRINT_REFERENCES,
    },
    null,
    0
  );
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
