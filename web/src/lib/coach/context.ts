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

export interface CoachContext {
  user_id: string;
  today: string; // YYYY-MM-DD
  profile: UserProfile | null;
  biometrics_today: BiometricsDaily | null; // falls back to yesterday if today missing
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

  // Biometrics — today, falling back to yesterday
  const { data: bioRows } = await supabase
    .from('biometrics_daily')
    .select('*')
    .eq('user_id', userId)
    .in('date', [today, yesterday])
    .order('date', { ascending: false });

  const biometrics_today =
    (bioRows ?? []).find((r) => r.date === today) ??
    (bioRows ?? []).find((r) => r.date === yesterday) ??
    null;

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

  return {
    user_id: userId,
    today,
    profile: profile ?? null,
    biometrics_today: biometrics_today as BiometricsDaily | null,
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
 */
export function contextToPromptInput(ctx: CoachContext): string {
  return JSON.stringify(
    {
      date: ctx.today,
      day_of_week: new Date(ctx.today).toLocaleString('en-US', { weekday: 'long' }),
      biometrics: ctx.biometrics_today
        ? {
            sleep_score: ctx.biometrics_today.sleep_score,
            sleep_duration_minutes: ctx.biometrics_today.sleep_duration_minutes,
            hrv_ms: ctx.biometrics_today.hrv_ms,
            resting_hr: ctx.biometrics_today.resting_hr,
            stress_avg: ctx.biometrics_today.stress_avg,
            training_load_acute: ctx.biometrics_today.training_load_acute,
            training_load_chronic: ctx.biometrics_today.training_load_chronic,
            source: ctx.biometrics_today.source,
            data_date: ctx.biometrics_today.date,
          }
        : null,
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
    },
    null,
    0
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
