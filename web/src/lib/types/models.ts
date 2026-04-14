export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';

export const MEAL_TYPES: MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export interface Food {
  id: string;
  user_id: string;
  name: string;
  brand: string;
  barcode: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: number;
  serving_unit: string;
  is_custom: boolean;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DiaryEntry {
  id: string;
  user_id: string;
  date: string;
  meal_type: MealType;
  number_of_servings: number;
  food_id: string | null;
  recipe_id: string | null;
  food?: Food;
  recipe?: Recipe;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DailyGoal {
  id: string;
  user_id: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  day_of_week: number;
  updated_at: string;
}

export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  servings: number;
  ingredients?: RecipeIngredient[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  food_id: string;
  quantity: number;
  food?: Food;
  created_at: string;
  updated_at: string;
}

export interface WeightEntry {
  id: string;
  user_id: string;
  date: string;
  weight: number;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MealTemplate {
  id: string;
  user_id: string;
  name: string;
  meal_type: MealType;
  items?: MealTemplateItem[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MealTemplateItem {
  id: string;
  template_id: string;
  food_id: string;
  number_of_servings: number;
  food?: Food;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  nutritionix_app_id: string;
  nutritionix_app_key: string;
  usda_api_key: string;
  updated_at: string;
}

export type FoodSource = 'openfoodfacts' | 'usda' | 'nutritionix';

export interface FoodProduct {
  name: string;
  brand: string;
  barcode: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: string;
  source: FoodSource;
}
