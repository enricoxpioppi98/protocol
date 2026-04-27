import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { BriefingMeal, MealSlot, MealType } from '@/lib/types/models';

/**
 * POST /api/diary/log-briefing-meal
 *
 * Body: { briefing_date: string (YYYY-MM-DD), meal_index: number }
 *
 * Logs an AI-generated briefing meal to the user's diary as a Recipe so the
 * diary shows ONE row per meal (instead of 4-6 separate food rows).
 *
 * Flow:
 *  1. Fetch the user's daily_briefing for `briefing_date` and pick the meal at
 *     `meal_index`.
 *  2. For each item in the meal, find-or-create a Food (case-insensitive name
 *     match within the user's foods). Newly-created foods get macros computed
 *     PER 100g, distributed proportionally to gram weight across the meal:
 *
 *       gramFraction       = item.grams / totalGrams
 *       itemKcal           = mealKcal * gramFraction
 *       caloriesPer100g    = itemKcal * (100 / item.grams)
 *       proteinPer100g     = mealProtein * gramFraction * (100 / item.grams)
 *       carbsPer100g       = mealCarbs   * gramFraction * (100 / item.grams)
 *       fatPer100g         = mealFat     * gramFraction * (100 / item.grams)
 *
 *     Note: gramFraction * (100 / item.grams) simplifies to 100 / totalGrams,
 *     so every newly-created food in a single meal carries the same per-100g
 *     macro density. This is an intentional approximation — the goal is the
 *     meal-level summary, not a perfect food database.
 *
 *  3. Create a Recipe with `name = meal.name`, `servings = 1`, and one
 *     recipe_ingredient per item with `quantity = item.grams / serving_size`
 *     (i.e. how many "servings" of that food the meal contains).
 *
 *  4. Create one diary_entry with `recipe_id`, today-mapped meal_type,
 *     `number_of_servings = 1`. Whole meal = one diary row.
 *
 * No raw SQL transactions (Supabase doesn't expose them cleanly). Sequential
 * awaits with try/catch — if a step fails, partial state may persist; we log
 * a warning rather than retry.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LogBriefingMealBody {
  briefing_date?: unknown;
  meal_index?: unknown;
}

const SLOT_TO_MEAL_TYPE: Record<MealSlot, MealType> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s).getTime();
  return !Number.isNaN(t);
}

function todayLocalISO(): string {
  // Server-side local date — matches the heuristic used elsewhere in the app
  // (briefing/today/route.ts uses new Date().toISOString().slice(0, 10) which
  // is UTC; we mirror that for consistency with how briefings are keyed).
  return new Date().toISOString().slice(0, 10);
}

function roundTo(n: number, places: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as LogBriefingMealBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const briefingDate = typeof body.briefing_date === 'string' ? body.briefing_date.trim() : '';
  const mealIndex = typeof body.meal_index === 'number' ? body.meal_index : -1;

  if (!briefingDate || !isValidDate(briefingDate)) {
    return NextResponse.json(
      { error: 'briefing_date must be YYYY-MM-DD' },
      { status: 400 }
    );
  }
  if (!Number.isInteger(mealIndex) || mealIndex < 0) {
    return NextResponse.json(
      { error: 'meal_index must be a non-negative integer' },
      { status: 400 }
    );
  }

  // 1. Fetch briefing and target meal.
  const { data: briefing, error: briefingErr } = await supabase
    .from('daily_briefing')
    .select('meals')
    .eq('user_id', user.id)
    .eq('date', briefingDate)
    .maybeSingle();

  if (briefingErr) {
    console.error('[log-briefing-meal] briefing fetch error', briefingErr);
    return NextResponse.json({ error: 'failed to load briefing' }, { status: 500 });
  }
  if (!briefing) {
    return NextResponse.json({ error: 'briefing not found' }, { status: 404 });
  }

  const meals = (briefing.meals ?? []) as BriefingMeal[];
  if (!Array.isArray(meals) || mealIndex >= meals.length) {
    return NextResponse.json({ error: 'meal not found' }, { status: 404 });
  }

  const meal = meals[mealIndex];
  if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
    return NextResponse.json({ error: 'meal has no items' }, { status: 400 });
  }

  const slot = meal.slot;
  const mealType = SLOT_TO_MEAL_TYPE[slot];
  if (!mealType) {
    return NextResponse.json({ error: 'meal has invalid slot' }, { status: 400 });
  }

  const totalGrams = meal.items.reduce(
    (sum, it) => sum + (Number.isFinite(it.grams) && it.grams > 0 ? it.grams : 0),
    0
  );
  if (totalGrams <= 0) {
    return NextResponse.json({ error: 'meal items have no weight' }, { status: 400 });
  }

  // 2. Find-or-create a Food for each item.
  let foodsCreated = 0;
  const itemFoods: { food_id: string; serving_size: number; grams: number }[] = [];

  const mealKcal = Number.isFinite(meal.macros?.kcal) ? meal.macros.kcal : 0;
  const mealP = Number.isFinite(meal.macros?.p) ? meal.macros.p : 0;
  const mealC = Number.isFinite(meal.macros?.c) ? meal.macros.c : 0;
  const mealF = Number.isFinite(meal.macros?.f) ? meal.macros.f : 0;

  for (const item of meal.items) {
    const itemName = (item.food ?? '').trim();
    if (!itemName) continue;
    const grams = Number.isFinite(item.grams) && item.grams > 0 ? item.grams : 0;
    if (grams <= 0) continue;

    // Case-insensitive match within this user's foods.
    const { data: existing, error: lookupErr } = await supabase
      .from('foods')
      .select('id, serving_size')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .ilike('name', itemName)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.warn('[log-briefing-meal] food lookup failed', lookupErr);
    }

    if (existing) {
      itemFoods.push({
        food_id: existing.id,
        serving_size: existing.serving_size ?? 100,
        grams,
      });
      continue;
    }

    // Per-100g macro density distributed by gram weight across the meal.
    const density = 100 / totalGrams; // gramFraction * (100 / grams) simplifies to this
    const calories = roundTo(mealKcal * density, 1);
    const protein = roundTo(mealP * density, 2);
    const carbs = roundTo(mealC * density, 2);
    const fat = roundTo(mealF * density, 2);

    const { data: created, error: insertErr } = await supabase
      .from('foods')
      .insert({
        user_id: user.id,
        name: itemName,
        brand: '',
        barcode: '',
        calories,
        protein,
        carbs,
        fat,
        fiber: 0,
        serving_size: 100,
        serving_unit: 'g',
        is_custom: true,
        is_favorite: false,
      })
      .select('id, serving_size')
      .single();

    if (insertErr || !created) {
      console.error('[log-briefing-meal] food insert failed', insertErr);
      return NextResponse.json(
        { error: 'failed to create food' },
        { status: 500 }
      );
    }

    foodsCreated += 1;
    itemFoods.push({
      food_id: created.id,
      serving_size: created.serving_size ?? 100,
      grams,
    });
  }

  if (itemFoods.length === 0) {
    return NextResponse.json(
      { error: 'no valid items to log' },
      { status: 400 }
    );
  }

  // 3. Create the Recipe.
  const { data: recipe, error: recipeErr } = await supabase
    .from('recipes')
    .insert({
      user_id: user.id,
      name: meal.name && meal.name.trim() ? meal.name.trim() : 'AI meal',
      servings: 1,
    })
    .select('id')
    .single();

  if (recipeErr || !recipe) {
    console.error('[log-briefing-meal] recipe insert failed', recipeErr);
    return NextResponse.json({ error: 'failed to create recipe' }, { status: 500 });
  }

  // 3b. Insert recipe ingredients.
  const ingredientRows = itemFoods.map((it) => ({
    recipe_id: recipe.id,
    food_id: it.food_id,
    quantity: roundTo(it.grams / (it.serving_size > 0 ? it.serving_size : 100), 4),
  }));

  const { error: ingErr } = await supabase
    .from('recipe_ingredients')
    .insert(ingredientRows);

  if (ingErr) {
    console.error('[log-briefing-meal] recipe_ingredients insert failed', ingErr);
    return NextResponse.json(
      { error: 'failed to attach ingredients to recipe' },
      { status: 500 }
    );
  }

  // 4. Create the diary entry — today's date, mapped meal_type, 1 serving.
  const today = todayLocalISO();
  const { data: entry, error: entryErr } = await supabase
    .from('diary_entries')
    .insert({
      user_id: user.id,
      date: today,
      meal_type: mealType,
      number_of_servings: 1,
      recipe_id: recipe.id,
      food_id: null,
    })
    .select('id')
    .single();

  if (entryErr || !entry) {
    console.error('[log-briefing-meal] diary_entry insert failed', entryErr);
    return NextResponse.json(
      { error: 'failed to create diary entry' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    recipe_id: recipe.id,
    diary_entry_id: entry.id,
    meal_type: mealType,
    foods_created: foodsCreated,
  });
}
