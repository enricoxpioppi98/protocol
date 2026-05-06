import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BriefingMeal,
  BriefingWorkout,
  ChatMessage,
  DiaryEntry,
  Food,
  Recipe,
  UserProfile,
} from '@/lib/types/models';
import type { WeeklyReviewInputs } from './weekly-review';

/**
 * Track 25 — collect the inputs the weekly-review generator needs.
 *
 * Kept separate from `weekly-review.ts` so the prompt-side library has zero
 * Supabase imports (lets it be unit-tested without a DB).
 */

export interface WeekWindow {
  /** Monday of the week being reviewed, YYYY-MM-DD. */
  week_start: string;
  /** Sunday of the week being reviewed, YYYY-MM-DD. */
  week_end: string;
}

interface ComputeWeekWindowOpts {
  /**
   * If true, treat the given date itself as the Monday of the window. If false
   * (default), find the most-recent completed Sunday relative to `now` and
   * return Mon..Sun ending on that Sunday.
   *
   * The cron route fires Sunday 19:00 UTC and wants the week ending today
   * (Sun) — which is exactly what the default case returns.
   */
  fromMonday?: boolean;
}

/**
 * Compute the (week_start, week_end) window for the just-completed week.
 *
 * Default: relative to `now`, find the most-recent Sunday at-or-before today
 * (Sunday-or-earlier-this-week), and return Mon..Sun ending on that Sunday.
 *   - Sunday 19:00 UTC cron → today's Mon..today
 *   - Mon 00:00 UTC backfill run → last Mon..last Sun
 *
 * `fromMonday: true` — `now` is already the Monday of the desired window.
 */
export function computeWeekWindow(
  now: Date = new Date(),
  opts: ComputeWeekWindowOpts = {}
): WeekWindow {
  const { fromMonday = false } = opts;
  if (fromMonday) {
    const monday = isoDateUTC(now);
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() + 6);
    return { week_start: monday, week_end: isoDateUTC(end) };
  }

  // Find most-recent Sunday at-or-before now (UTC). JS day-of-week: 0=Sun..6=Sat.
  const dow = now.getUTCDay();
  const sunday = new Date(now);
  // If today is Sunday, daysBack=0 (today is the week_end). Otherwise step
  // back to the previous Sunday — i.e. Tue → -2 days = Sunday.
  const daysBack = dow; // Sun=0 → 0, Mon=1 → 1, ... Sat=6 → 6
  sunday.setUTCDate(sunday.getUTCDate() - daysBack);
  const monday = new Date(sunday);
  monday.setUTCDate(monday.getUTCDate() - 6);
  return { week_start: isoDateUTC(monday), week_end: isoDateUTC(sunday) };
}

function isoDateUTC(d: Date): string {
  // Stable YYYY-MM-DD in UTC. Avoids local-tz drift on the server.
  return d.toISOString().slice(0, 10);
}

interface BiometricsLite {
  date: string;
  sleep_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  training_load_acute: number | null;
  total_steps: number | null;
}

/**
 * Build the WeeklyReviewInputs payload for one user + window. Designed so the
 * cron route and the on-demand POST share the same code path — same data
 * shape, same query plan, same prompt cache prefix.
 */
export async function buildWeeklyReviewInputs(
  admin: SupabaseClient,
  userId: string,
  window: WeekWindow
): Promise<WeeklyReviewInputs> {
  const [bio, briefings, diary, chat, profile] = await Promise.all([
    admin
      .from('biometrics_daily_merged')
      .select(
        'date, sleep_score, hrv_ms, resting_hr, training_load_acute, total_steps'
      )
      .eq('user_id', userId)
      .gte('date', window.week_start)
      .lte('date', window.week_end)
      .order('date', { ascending: true }),
    admin
      .from('daily_briefing')
      .select('date, workout, meals')
      .eq('user_id', userId)
      .gte('date', window.week_start)
      .lte('date', window.week_end)
      .order('date', { ascending: true }),
    admin
      .from('diary_entries')
      .select(
        'id, user_id, date, meal_type, number_of_servings, food_id, recipe_id, food:foods(*), recipe:recipes(*, ingredients:recipe_ingredients(*, food:foods(*)))'
      )
      .eq('user_id', userId)
      .gte('date', window.week_start)
      .lte('date', window.week_end)
      .is('deleted_at', null),
    admin
      .from('chat_messages')
      .select('id, user_id, role, content, created_at')
      .eq('user_id', userId)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('user_profile').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  const biometrics_7d = ((bio.data ?? []) as BiometricsLite[]).map((r) => ({
    date: r.date,
    sleep_score: r.sleep_score,
    hrv_ms: r.hrv_ms,
    resting_hr: r.resting_hr,
    training_load_acute: r.training_load_acute,
    total_steps: r.total_steps,
  }));

  const workouts_7d = ((briefings.data ?? []) as Array<{
    date: string;
    workout: BriefingWorkout | null;
    meals: BriefingMeal[] | null;
  }>)
    .filter((b) => b.workout && b.workout.name)
    .map((b) => ({
      date: b.date,
      name: b.workout!.name,
      duration_minutes:
        typeof b.workout!.duration_minutes === 'number'
          ? b.workout!.duration_minutes
          : null,
    }));

  const macro_digest = aggregateMacroDigest(
    (diary.data ?? []) as unknown as DiaryEntry[]
  );

  const chat_highlights = ((chat.data ?? []) as ChatMessage[])
    .map((m) => (m.content ?? '').trim())
    .filter((s) => s.length > 0)
    .slice(0, 10)
    .reverse(); // chronological so the model reads the week's arc

  const profileTyped = (profile.data ?? null) as UserProfile | null;
  const profile_goals = profileTyped?.goals
    ? (profileTyped.goals as Record<string, unknown>)
    : null;

  return {
    user_id: userId,
    week_start: window.week_start,
    week_end: window.week_end,
    biometrics_7d,
    workouts_7d,
    macro_digest,
    chat_highlights,
    profile_goals,
  };
}

/**
 * Average per-day macros over the diary rows in the window. Mirrors
 * `aggregateMacros` in lib/coach/context.ts but folds across multiple days
 * and emits average-per-logged-day. `days_logged` distinguishes "0 kcal avg
 * because user didn't log" from "0 kcal because user actually fasted".
 */
function aggregateMacroDigest(
  entries: DiaryEntry[]
): WeeklyReviewInputs['macro_digest'] {
  if (entries.length === 0) return null;

  const byDate = new Map<string, { kcal: number; protein: number; fiber: number }>();
  for (const entry of entries) {
    const day =
      byDate.get(entry.date) ?? { kcal: 0, protein: 0, fiber: 0 };
    const servings = entry.number_of_servings;
    if (entry.food) {
      day.kcal += entry.food.calories * servings;
      day.protein += entry.food.protein * servings;
      day.fiber += entry.food.fiber * servings;
    } else if (entry.recipe?.ingredients) {
      const r = sumRecipePerServing(entry.recipe);
      day.kcal += r.kcal * servings;
      day.protein += r.protein * servings;
      day.fiber += r.fiber * servings;
    }
    byDate.set(entry.date, day);
  }

  const days = byDate.size;
  if (days === 0) return null;

  let kcalSum = 0;
  let proteinSum = 0;
  let fiberSum = 0;
  for (const v of byDate.values()) {
    kcalSum += v.kcal;
    proteinSum += v.protein;
    fiberSum += v.fiber;
  }

  return {
    avg_kcal: Math.round(kcalSum / days),
    avg_protein_g: Math.round(proteinSum / days),
    avg_fiber_g: Math.round(fiberSum / days),
    days_logged: days,
  };
}

function sumRecipePerServing(
  recipe: Recipe
): { kcal: number; protein: number; fiber: number } {
  const total = { kcal: 0, protein: 0, fiber: 0 };
  if (!recipe.ingredients) return total;
  for (const ing of recipe.ingredients) {
    if (!ing.food) continue;
    const f: Food = ing.food;
    const q = ing.quantity;
    total.kcal += f.calories * q;
    total.protein += f.protein * q;
    total.fiber += f.fiber * q;
  }
  const servings = Math.max(recipe.servings, 1);
  return {
    kcal: total.kcal / servings,
    protein: total.protein / servings,
    fiber: total.fiber / servings,
  };
}
