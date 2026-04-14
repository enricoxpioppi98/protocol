import type { DiaryEntry, Food, Recipe, DailyGoal } from '@/lib/types/models';

export function entryCalories(entry: DiaryEntry): number {
  if (entry.food) return entry.food.calories * entry.number_of_servings;
  if (entry.recipe) return recipeCaloriesPerServing(entry.recipe) * entry.number_of_servings;
  return 0;
}

export function entryProtein(entry: DiaryEntry): number {
  if (entry.food) return entry.food.protein * entry.number_of_servings;
  if (entry.recipe) return recipeProteinPerServing(entry.recipe) * entry.number_of_servings;
  return 0;
}

export function entryCarbs(entry: DiaryEntry): number {
  if (entry.food) return entry.food.carbs * entry.number_of_servings;
  if (entry.recipe) return recipeCarbsPerServing(entry.recipe) * entry.number_of_servings;
  return 0;
}

export function entryFat(entry: DiaryEntry): number {
  if (entry.food) return entry.food.fat * entry.number_of_servings;
  if (entry.recipe) return recipeFatPerServing(entry.recipe) * entry.number_of_servings;
  return 0;
}

export function entryName(entry: DiaryEntry): string {
  if (entry.food) return entry.food.name;
  if (entry.recipe) return entry.recipe.name;
  return 'Unknown';
}

// Recipe computed macros (matches Recipe.swift)
export function recipeTotalCalories(recipe: Recipe): number {
  return (recipe.ingredients ?? []).reduce(
    (sum, ing) => sum + (ing.food?.calories ?? 0) * ing.quantity,
    0
  );
}

export function recipeTotalProtein(recipe: Recipe): number {
  return (recipe.ingredients ?? []).reduce(
    (sum, ing) => sum + (ing.food?.protein ?? 0) * ing.quantity,
    0
  );
}

export function recipeTotalCarbs(recipe: Recipe): number {
  return (recipe.ingredients ?? []).reduce(
    (sum, ing) => sum + (ing.food?.carbs ?? 0) * ing.quantity,
    0
  );
}

export function recipeTotalFat(recipe: Recipe): number {
  return (recipe.ingredients ?? []).reduce(
    (sum, ing) => sum + (ing.food?.fat ?? 0) * ing.quantity,
    0
  );
}

export function recipeCaloriesPerServing(recipe: Recipe): number {
  return recipeTotalCalories(recipe) / (recipe.servings || 1);
}

export function recipeProteinPerServing(recipe: Recipe): number {
  return recipeTotalProtein(recipe) / (recipe.servings || 1);
}

export function recipeCarbsPerServing(recipe: Recipe): number {
  return recipeTotalCarbs(recipe) / (recipe.servings || 1);
}

export function recipeFatPerServing(recipe: Recipe): number {
  return recipeTotalFat(recipe) / (recipe.servings || 1);
}

// Goal resolution (matches DailyGoal+Resolved.swift)
export function goalForDate(goals: DailyGoal[], date: Date): DailyGoal | null {
  // Calendar weekday: 1=Sunday, 2=Monday, ..., 7=Saturday (matches iOS Calendar.component(.weekday))
  const weekday = date.getDay() + 1; // JS getDay() is 0=Sun, so +1

  const specific = goals.find((g) => g.day_of_week === weekday);
  if (specific) return specific;

  const defaultGoal = goals.find((g) => g.day_of_week === 0);
  return defaultGoal ?? null;
}

// Summary for a list of entries
export function entriesTotals(entries: DiaryEntry[]) {
  return entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + entryCalories(entry),
      protein: acc.protein + entryProtein(entry),
      carbs: acc.carbs + entryCarbs(entry),
      fat: acc.fat + entryFat(entry),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
