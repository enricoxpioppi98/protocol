import type { SupabaseClient } from '@supabase/supabase-js';
import type { MealType } from '@/lib/types/models';

/**
 * Shared "wrap a structured meal into a Recipe + diary row" helper.
 *
 * Used by:
 *   - `/api/diary/log-briefing-meal` — pulls a meal off the day's briefing.
 *   - `/api/diary/photo-log` — logs a meal Claude identified from a photo.
 *
 * Both routes need the same find-or-create-Food + Recipe + diary_entry flow,
 * so we centralise it here. The behaviour mirrors the original
 * `log-briefing-meal/route.ts`:
 *
 *  - Newly-created Foods get per-100g macros distributed proportionally to
 *    gram weight across the meal. Because `gramFraction * (100 / item.grams)`
 *    simplifies to `100 / totalGrams`, every food created in the same meal
 *    carries the same per-100g density. Intentional approximation — the goal
 *    is the meal-level summary, not a perfect food database.
 *  - One Recipe per meal, `servings = 1`. One diary_entry, `number_of_servings = 1`.
 *
 * Errors throw `PersistMealError` with an HTTP-ish status so route handlers
 * can map them to a NextResponse without re-implementing the error contract.
 */

export interface PersistMealItem {
  food: string;
  grams: number;
}

export interface PersistMealMacros {
  kcal: number;
  p: number;
  c: number;
  f: number;
}

export interface PersistMealInput {
  name: string;
  items: PersistMealItem[];
  macros: PersistMealMacros;
}

export interface PersistMealResult {
  recipe_id: string;
  diary_entry_id: string;
  foods_created: number;
  /** Per-item resolved foods, in input order. Useful for the photo-log response. */
  items: Array<{
    food_id: string;
    food: string;
    grams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
}

export class PersistMealError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'PersistMealError';
  }
}

function roundTo(n: number, places: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

export async function persistMealToDiary(args: {
  supabase: SupabaseClient;
  userId: string;
  meal: PersistMealInput;
  date: string;
  mealType: MealType;
}): Promise<PersistMealResult> {
  const { supabase, userId, meal, date, mealType } = args;

  if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
    throw new PersistMealError(400, 'meal has no items');
  }

  const totalGrams = meal.items.reduce(
    (sum, it) => sum + (Number.isFinite(it.grams) && it.grams > 0 ? it.grams : 0),
    0
  );
  if (totalGrams <= 0) {
    throw new PersistMealError(400, 'meal items have no weight');
  }

  const mealKcal = Number.isFinite(meal.macros?.kcal) ? meal.macros.kcal : 0;
  const mealP = Number.isFinite(meal.macros?.p) ? meal.macros.p : 0;
  const mealC = Number.isFinite(meal.macros?.c) ? meal.macros.c : 0;
  const mealF = Number.isFinite(meal.macros?.f) ? meal.macros.f : 0;

  // Per-100g density distributed by gram weight across the meal.
  // gramFraction * (100 / grams) === 100 / totalGrams, so every food in the
  // meal shares one density.
  const density = 100 / totalGrams;
  const caloriesPer100g = roundTo(mealKcal * density, 1);
  const proteinPer100g = roundTo(mealP * density, 2);
  const carbsPer100g = roundTo(mealC * density, 2);
  const fatPer100g = roundTo(mealF * density, 2);

  // Find-or-create a Food per item.
  let foodsCreated = 0;
  const itemFoods: Array<{
    food_id: string;
    food: string;
    serving_size: number;
    grams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }> = [];

  for (const item of meal.items) {
    const itemName = (item.food ?? '').trim();
    if (!itemName) continue;
    const grams = Number.isFinite(item.grams) && item.grams > 0 ? item.grams : 0;
    if (grams <= 0) continue;

    const { data: existing, error: lookupErr } = await supabase
      .from('foods')
      .select('id, serving_size, calories, protein, carbs, fat')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .ilike('name', itemName)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.warn('[persistMeal] food lookup failed', lookupErr);
    }

    if (existing) {
      const servingSize = existing.serving_size ?? 100;
      const ratio = grams / (servingSize > 0 ? servingSize : 100);
      itemFoods.push({
        food_id: existing.id,
        food: itemName,
        serving_size: servingSize,
        grams,
        calories: roundTo((existing.calories ?? 0) * ratio, 1),
        protein: roundTo((existing.protein ?? 0) * ratio, 2),
        carbs: roundTo((existing.carbs ?? 0) * ratio, 2),
        fat: roundTo((existing.fat ?? 0) * ratio, 2),
      });
      continue;
    }

    const { data: created, error: insertErr } = await supabase
      .from('foods')
      .insert({
        user_id: userId,
        name: itemName,
        brand: '',
        barcode: '',
        calories: caloriesPer100g,
        protein: proteinPer100g,
        carbs: carbsPer100g,
        fat: fatPer100g,
        fiber: 0,
        serving_size: 100,
        serving_unit: 'g',
        is_custom: true,
        is_favorite: false,
      })
      .select('id, serving_size')
      .single();

    if (insertErr || !created) {
      console.error('[persistMeal] food insert failed', insertErr);
      throw new PersistMealError(500, 'failed to create food');
    }

    foodsCreated += 1;
    const servingSize = created.serving_size ?? 100;
    const ratio = grams / (servingSize > 0 ? servingSize : 100);
    itemFoods.push({
      food_id: created.id,
      food: itemName,
      serving_size: servingSize,
      grams,
      calories: roundTo(caloriesPer100g * ratio, 1),
      protein: roundTo(proteinPer100g * ratio, 2),
      carbs: roundTo(carbsPer100g * ratio, 2),
      fat: roundTo(fatPer100g * ratio, 2),
    });
  }

  if (itemFoods.length === 0) {
    throw new PersistMealError(400, 'no valid items to log');
  }

  // Create the Recipe.
  const recipeName = meal.name && meal.name.trim() ? meal.name.trim() : 'AI meal';
  const { data: recipe, error: recipeErr } = await supabase
    .from('recipes')
    .insert({
      user_id: userId,
      name: recipeName,
      servings: 1,
    })
    .select('id')
    .single();

  if (recipeErr || !recipe) {
    console.error('[persistMeal] recipe insert failed', recipeErr);
    throw new PersistMealError(500, 'failed to create recipe');
  }

  const ingredientRows = itemFoods.map((it) => ({
    recipe_id: recipe.id,
    food_id: it.food_id,
    quantity: roundTo(it.grams / (it.serving_size > 0 ? it.serving_size : 100), 4),
  }));

  const { error: ingErr } = await supabase
    .from('recipe_ingredients')
    .insert(ingredientRows);

  if (ingErr) {
    console.error('[persistMeal] recipe_ingredients insert failed', ingErr);
    throw new PersistMealError(500, 'failed to attach ingredients to recipe');
  }

  const { data: entry, error: entryErr } = await supabase
    .from('diary_entries')
    .insert({
      user_id: userId,
      date,
      meal_type: mealType,
      number_of_servings: 1,
      recipe_id: recipe.id,
      food_id: null,
    })
    .select('id')
    .single();

  if (entryErr || !entry) {
    console.error('[persistMeal] diary_entry insert failed', entryErr);
    throw new PersistMealError(500, 'failed to create diary entry');
  }

  return {
    recipe_id: recipe.id,
    diary_entry_id: entry.id,
    foods_created: foodsCreated,
    items: itemFoods.map((it) => ({
      food_id: it.food_id,
      food: it.food,
      grams: it.grams,
      calories: it.calories,
      protein: it.protein,
      carbs: it.carbs,
      fat: it.fat,
    })),
  };
}
