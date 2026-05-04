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
  fiber: number;
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
  fiber: number;
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
  fiber: number;
  serving_size: string;
  source: FoodSource;
}

// ============================================================
// Protocol v1: AI coaching layer
// ============================================================

export type Gender = 'male' | 'female' | 'nonbinary' | 'prefer_not_to_say';
export type TrainingExperience = 'beginner' | 'intermediate' | 'advanced';

export interface UserProfile {
  user_id: string;
  goals: {
    primary?: string;
    secondary?: string;
    [key: string]: unknown;
  };
  dietary_restrictions: string[];
  equipment_available: string[];
  weekly_schedule: {
    [day: string]: string[] | undefined; // e.g. monday: ["lift"], tuesday: ["run", "easy"]
  };
  notes: string;
  /**
   * Identifiers of biometric metrics the user has pinned to the dashboard
   * BiometricsCard. Order is preserved (pin order = render order). See
   * `AVAILABLE_METRICS` in `BiometricsCard.tsx` for the catalog and migration
   * `007_pinned_metrics.sql` for the column default.
   */
  pinned_metrics: string[];
  /**
   * Demographic context for the AI coach (migration 009). All optional —
   * onboarding-v2 captures these but the prompt tolerates missing values.
   * `weight_kg` is the user's baseline weight at onboarding time; live
   * tracking lives in `weight_entries`.
   */
  dob: string | null; // ISO date YYYY-MM-DD
  gender: Gender | null;
  height_cm: number | null;
  weight_kg: number | null;
  training_experience: TrainingExperience | null;
  /**
   * Derived genome traits parsed from a 23andMe raw upload (Track K, migration
   * 008). Keyed by stable trait identifier (e.g. `caffeine_metabolism`). Empty
   * object until the user uploads their raw data via the Genome tab. See
   * `lib/genome/catalog.ts` for the schema. Track L (the coaching context
   * assembler) reads these verbatim into the Claude prompt.
   */
  genome_traits: GenomeTraits;
  /**
   * UTC timestamp of the last successful 23andMe upload. Null if the user
   * has never uploaded. Used by the Genome page to surface "last updated".
   */
  genome_uploaded_at: string | null;
  /**
   * Per-user metric source priority list (migration 013). Drives the
   * `biometrics_daily_merged` view: index 0 = highest priority. v2 only
   * consumes `default`, applied uniformly to every metric column. Future
   * revisions may add per-metric overrides (e.g. `{"hrv_ms": [...]}`).
   * Edited via `PUT /api/profile/source-priority`.
   */
  metric_source_priority: {
    default: BiometricsSource[];
    [metric: string]: BiometricsSource[] | undefined;
  };
  created_at: string;
  updated_at: string;
}

// ============================================================
// Genome
// ============================================================

/**
 * A single derived genome trait. The user's genotype + the catalog entry's
 * variant interpretation, flattened so the AI coach can read it directly
 * without needing to re-join with the catalog.
 */
export interface GenomeTrait {
  /** Plain-English value for the variant, e.g. "fast", "endurance", "ε3/ε3". */
  value: string;
  /** 1-2 sentence lifestyle coaching implication (no medical claims). */
  coaching: string;
  /** dbSNP rsid we matched on. */
  rsid: string;
  /** Gene symbol the SNP sits in. */
  gene: string;
  /** The user's genotype as alphabetically-sorted letters, e.g. "AC". */
  genotype: string;
}

/** Map of trait identifier → derived trait. Keys come from `SNP_CATALOG`. */
export type GenomeTraits = Record<string, GenomeTrait>;

export type BiometricsSource = 'garmin' | 'manual' | 'whoop' | 'apple_watch';

export interface BiometricsDaily {
  user_id: string;
  date: string;
  sleep_score: number | null;
  sleep_duration_minutes: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  training_load_acute: number | null;
  training_load_chronic: number | null;
  // Movement / activity volume
  total_steps: number | null;
  floors_climbed: number | null;
  active_minutes: number | null;
  vigorous_minutes: number | null;
  moderate_minutes: number | null;
  total_kcal_burned: number | null;
  active_kcal_burned: number | null;
  // Cardiovascular
  vo2max: number | null;
  max_hr: number | null;
  min_hr: number | null;
  // Sleep sub-stages
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
  awake_sleep_minutes: number | null;
  sleep_efficiency: number | null;
  // Body battery (Garmin's recovery sub-score)
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  source: BiometricsSource;
  raw: unknown | null;
  fetched_at: string;
  updated_at: string;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface BriefingMacros {
  kcal: number;
  p: number; // protein g
  c: number; // carbs g
  f: number; // fat g
}

export interface BriefingMealItem {
  food: string;
  grams: number;
}

export interface BriefingMeal {
  slot: MealSlot;
  name: string;
  items: BriefingMealItem[];
  macros: BriefingMacros;
}

export interface BriefingWorkoutBlock {
  name: string;
  sets?: number;
  reps?: string; // "8-10" or "5x"
  intensity?: string; // "RPE 8", "Z2", "85% 1RM"
  notes?: string;
}

export interface BriefingWorkout {
  name: string;
  duration_minutes: number;
  blocks: BriefingWorkoutBlock[];
}

export interface DailyBriefing {
  user_id: string;
  date: string;
  meals: BriefingMeal[];
  workout: BriefingWorkout;
  recovery_note: string;
  model: string;
  prompt_cache_hit: boolean;
  generated_at: string;
  regenerated_at: string | null;
  updated_at: string;
}

export interface GarminCredentialsRow {
  user_id: string;
  email: string;
  password_encrypted: string;
  created_at: string;
  updated_at: string;
}

/**
 * Whoop OAuth credentials. Server-only — the table has no SELECT policy for
 * authenticated clients. Reads/writes go through the service-role client in
 * `lib/supabase/admin.ts`. Tokens are AES-256-GCM ciphertext.
 */
export interface WhoopCredentialsRow {
  user_id: string;
  whoop_user_id: string | null;
  refresh_token_encrypted: string;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

export type ChatMessageRole = 'user' | 'assistant';

export type ChatToolStatus = 'pending' | 'running' | 'success' | 'error';

export interface ChatToolCall {
  id: string;
  name: string;
  status: ChatToolStatus;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: ChatMessageRole;
  content: string;
  tools: ChatToolCall[];
  created_at: string;
  updated_at: string;
}

// ============================================================
// Optional health signals (migration 010)
// ============================================================

/**
 * The context tag attached to a glucose reading. Drives downstream coaching
 * heuristics (a 145 mg/dL post-meal value is normal; a 145 mg/dL fasting value
 * is not). `random` is the dump bucket for unlabeled spot checks.
 */
export type GlucoseContext =
  | 'fasting'
  | 'pre_meal'
  | 'post_meal'
  | 'overnight'
  | 'workout'
  | 'random';

export type GlucoseSource = 'manual' | 'levels' | 'lingo' | 'stelo';

export interface GlucoseReading {
  id: string;
  user_id: string;
  recorded_at: string; // ISO timestamp
  mg_dl: number;
  context: GlucoseContext | null;
  source: GlucoseSource | string;
  notes: string;
  created_at: string;
  updated_at: string;
}

/**
 * Curated list of blood markers the coaching layer knows about. The DB column
 * stores `text` so the user can record any marker, but anything outside this
 * list is treated as freeform metadata — the coach only personalizes against
 * these names.
 */
export type BloodMarkerName =
  | 'ldl'
  | 'hdl'
  | 'tc'
  | 'apoB'
  | 'hsCRP'
  | 'hbA1c'
  | 'glucose_fasting'
  | 'triglycerides'
  | 'tsh'
  | 't4_free'
  | 'testosterone_total'
  | 'testosterone_free'
  | 'vitamin_d'
  | 'ferritin'
  | 'homocysteine';

export type BloodMarkerFlag = 'low' | 'normal' | 'high';

export type BloodPanelSource = 'manual' | 'pdf_upload';

export interface BloodMarkerReading {
  id: string;
  panel_id: string;
  marker: string; // BloodMarkerName | freeform
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  flag: BloodMarkerFlag | null;
}

export interface BloodPanel {
  id: string;
  user_id: string;
  panel_date: string; // YYYY-MM-DD
  lab: string;
  notes: string;
  source: BloodPanelSource;
  raw_pdf_url: string | null;
  created_at: string;
  updated_at: string;
  readings?: BloodMarkerReading[];
}

/**
 * Phases of the menstrual cycle as the coach personalizes them. We hold to a
 * default 28-day cycle but learn the user's actual gap from logged starts.
 *   1-5   menstruation
 *   6-13  follicular
 *   14-16 ovulation
 *   17-28 luteal
 * `unknown` is emitted when day-of-cycle can't be determined yet.
 */
export type CyclePhase =
  | 'menstruation'
  | 'follicular'
  | 'ovulation'
  | 'luteal'
  | 'unknown';

export interface CycleEntry {
  id: string;
  user_id: string;
  start_date: string; // YYYY-MM-DD
  duration_days: number; // 1..14
  notes: string;
  created_at: string;
  updated_at: string;
}
