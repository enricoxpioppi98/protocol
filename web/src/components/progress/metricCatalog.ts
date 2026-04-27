// Metric catalog for the multi-metric Progress dashboard.
//
// Each metric is keyed by a stable string id and points to one of three
// data sources (biometrics_daily, diary_entries, weight_entries). Getters
// return `number | null` per day; charts skip null days.
//
// NOTE on Track H: BiometricsDaily (in lib/types/models.ts) currently only
// declares sleep_score / sleep_duration_minutes / hrv_ms / resting_hr /
// stress_avg / training_load_acute / training_load_chronic. Track H is in
// flight to add the rest of the fields below (deep_sleep_minutes,
// rem_sleep_minutes, sleep_efficiency, max_hr, min_hr, vo2max, total_steps,
// active_minutes, vigorous_minutes, floors_climbed, total_kcal_burned,
// active_kcal_burned, body_battery_high, body_battery_low). Until that
// merges, we read these defensively at runtime via `(row as any).<field>`
// and let the chart simply show no data for missing fields. Once Track H
// lands the `as any` casts can be tightened.

import type { BiometricsDaily, DiaryEntry, DailyGoal, WeightEntry } from '@/lib/types/models';
import { entryCalories, entryProtein, entryCarbs, entryFat, entryFiber } from '@/lib/utils/macros';
import { goalForDate } from '@/lib/utils/macros';

export type MetricSource = 'biometrics' | 'diary' | 'weight';
export type MetricGroup = 'Sleep' | 'Heart' | 'Movement' | 'Energy' | 'Nutrition' | 'Body';

export interface MetricDailyContext {
  /** Diary entries scoped to a single date. */
  diaryEntries: DiaryEntry[];
  /** Goal resolved for that date (may be null). */
  goal: DailyGoal | null;
  /** Biometrics row for that date (may be null). */
  biometrics: BiometricsDaily | null;
  /** Weight entry for that date (may be null). */
  weight: WeightEntry | null;
}

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  group: MetricGroup;
  color: string;
  source: MetricSource;
  /** Returns the metric value for this date, or null if missing. */
  getter: (ctx: MetricDailyContext) => number | null;
}

// ---- Color palette (unique per metric, theme-friendly) -------------------
// Drawn from the existing accent + extra hand-picked hues so 6 overlaid
// series stay visually distinct in both light & dark themes.
const C = {
  blue: 'rgb(59, 130, 245)',       // accent
  amber: 'rgb(245, 158, 10)',      // highlight
  violet: 'rgb(140, 92, 245)',     // fat
  green: 'rgb(48, 209, 88)',       // fiber / success
  red: 'rgb(255, 69, 58)',         // danger
  cyan: 'rgb(64, 200, 224)',
  pink: 'rgb(255, 105, 180)',
  teal: 'rgb(20, 184, 166)',
  indigo: 'rgb(99, 102, 241)',
  orange: 'rgb(235, 115, 13)',
  lime: 'rgb(132, 204, 22)',
  rose: 'rgb(244, 63, 94)',
  sky: 'rgb(14, 165, 233)',
  yellow: 'rgb(234, 179, 8)',
  fuchsia: 'rgb(217, 70, 239)',
  emerald: 'rgb(16, 185, 129)',
} as const;

// Helper: pull a numeric field off a biometrics row, with the Track-H
// defensive `as any` cast.
function bioField(field: string) {
  return (ctx: MetricDailyContext): number | null => {
    if (!ctx.biometrics) return null;
    const v = (ctx.biometrics as unknown as Record<string, unknown>)[field];
    if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v;
  };
}

// Diary aggregator helper (sums across entries for the day).
function diarySum(fn: (e: DiaryEntry) => number) {
  return (ctx: MetricDailyContext): number | null => {
    if (ctx.diaryEntries.length === 0) return null;
    let total = 0;
    for (const e of ctx.diaryEntries) total += fn(e);
    return total;
  };
}

// Percent-of-goal helper for a daily nutrition metric.
function pctOfGoal(
  numerator: (e: DiaryEntry) => number,
  goalKey: keyof Pick<DailyGoal, 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber'>,
) {
  return (ctx: MetricDailyContext): number | null => {
    if (ctx.diaryEntries.length === 0) return null;
    const goalVal = ctx.goal ? (ctx.goal[goalKey] as number) : 0;
    if (!goalVal || goalVal <= 0) return null;
    let total = 0;
    for (const e of ctx.diaryEntries) total += numerator(e);
    return (total / goalVal) * 100;
  };
}

export const METRICS: MetricDef[] = [
  // ---- Sleep ------------------------------------------------------------
  { id: 'sleep_score',           label: 'Sleep Score',     unit: '',     group: 'Sleep',     color: C.indigo,  source: 'biometrics', getter: bioField('sleep_score') },
  { id: 'sleep_duration_minutes',label: 'Sleep Duration',  unit: 'min',  group: 'Sleep',     color: C.blue,    source: 'biometrics', getter: bioField('sleep_duration_minutes') },
  { id: 'deep_sleep_minutes',    label: 'Deep Sleep',      unit: 'min',  group: 'Sleep',     color: C.violet,  source: 'biometrics', getter: bioField('deep_sleep_minutes') },
  { id: 'rem_sleep_minutes',     label: 'REM Sleep',       unit: 'min',  group: 'Sleep',     color: C.fuchsia, source: 'biometrics', getter: bioField('rem_sleep_minutes') },
  { id: 'sleep_efficiency',      label: 'Sleep Efficiency',unit: '%',    group: 'Sleep',     color: C.cyan,    source: 'biometrics', getter: bioField('sleep_efficiency') },

  // ---- Heart ------------------------------------------------------------
  { id: 'hrv_ms',                label: 'HRV',             unit: 'ms',   group: 'Heart',     color: C.green,   source: 'biometrics', getter: bioField('hrv_ms') },
  { id: 'resting_hr',            label: 'Resting HR',      unit: 'bpm',  group: 'Heart',     color: C.red,     source: 'biometrics', getter: bioField('resting_hr') },
  { id: 'max_hr',                label: 'Max HR',          unit: 'bpm',  group: 'Heart',     color: C.rose,    source: 'biometrics', getter: bioField('max_hr') },
  { id: 'min_hr',                label: 'Min HR',          unit: 'bpm',  group: 'Heart',     color: C.pink,    source: 'biometrics', getter: bioField('min_hr') },
  { id: 'vo2max',                label: 'VO2max',          unit: '',     group: 'Heart',     color: C.teal,    source: 'biometrics', getter: bioField('vo2max') },
  { id: 'stress_avg',            label: 'Stress (avg)',    unit: '',     group: 'Heart',     color: C.orange,  source: 'biometrics', getter: bioField('stress_avg') },

  // ---- Movement ---------------------------------------------------------
  { id: 'total_steps',           label: 'Steps',           unit: '',     group: 'Movement',  color: C.amber,   source: 'biometrics', getter: bioField('total_steps') },
  { id: 'active_minutes',        label: 'Active Min',      unit: 'min',  group: 'Movement',  color: C.lime,    source: 'biometrics', getter: bioField('active_minutes') },
  { id: 'vigorous_minutes',      label: 'Vigorous Min',    unit: 'min',  group: 'Movement',  color: C.emerald, source: 'biometrics', getter: bioField('vigorous_minutes') },
  { id: 'floors_climbed',        label: 'Floors Climbed',  unit: '',     group: 'Movement',  color: C.sky,     source: 'biometrics', getter: bioField('floors_climbed') },

  // ---- Energy / Load ----------------------------------------------------
  { id: 'total_kcal_burned',     label: 'Total kcal Burned',  unit: 'kcal', group: 'Energy', color: C.orange,  source: 'biometrics', getter: bioField('total_kcal_burned') },
  { id: 'active_kcal_burned',    label: 'Active kcal Burned', unit: 'kcal', group: 'Energy', color: C.yellow,  source: 'biometrics', getter: bioField('active_kcal_burned') },
  { id: 'body_battery_high',     label: 'Body Battery (high)',unit: '',     group: 'Energy', color: C.green,   source: 'biometrics', getter: bioField('body_battery_high') },
  { id: 'body_battery_low',      label: 'Body Battery (low)', unit: '',     group: 'Energy', color: C.red,     source: 'biometrics', getter: bioField('body_battery_low') },
  { id: 'training_load_acute',   label: 'Training Load (7d)', unit: '',     group: 'Energy', color: C.indigo,  source: 'biometrics', getter: bioField('training_load_acute') },
  { id: 'training_load_chronic', label: 'Training Load (28d)',unit: '',     group: 'Energy', color: C.violet,  source: 'biometrics', getter: bioField('training_load_chronic') },

  // ---- Nutrition --------------------------------------------------------
  { id: 'calories_consumed',     label: 'Calories Consumed',  unit: 'kcal', group: 'Nutrition', color: C.amber,  source: 'diary', getter: diarySum(entryCalories) },
  { id: 'protein_consumed',      label: 'Protein',            unit: 'g',    group: 'Nutrition', color: C.blue,   source: 'diary', getter: diarySum(entryProtein) },
  { id: 'carbs_consumed',        label: 'Carbs',              unit: 'g',    group: 'Nutrition', color: C.orange, source: 'diary', getter: diarySum(entryCarbs) },
  { id: 'fat_consumed',          label: 'Fat',                unit: 'g',    group: 'Nutrition', color: C.violet, source: 'diary', getter: diarySum(entryFat) },
  { id: 'fiber_consumed',        label: 'Fiber',              unit: 'g',    group: 'Nutrition', color: C.green,  source: 'diary', getter: diarySum(entryFiber) },
  { id: 'protein_pct_goal',      label: 'Protein % Goal',     unit: '%',    group: 'Nutrition', color: C.sky,    source: 'diary', getter: pctOfGoal(entryProtein, 'protein') },
  { id: 'calories_pct_goal',     label: 'Calories % Goal',    unit: '%',    group: 'Nutrition', color: C.yellow, source: 'diary', getter: pctOfGoal(entryCalories, 'calories') },

  // ---- Body -------------------------------------------------------------
  {
    id: 'weight',
    label: 'Weight',
    unit: 'lbs',
    group: 'Body',
    color: C.teal,
    source: 'weight',
    getter: (ctx) => (ctx.weight ? ctx.weight.weight : null),
  },
];

export const METRICS_BY_ID: Record<string, MetricDef> = METRICS.reduce(
  (acc, m) => { acc[m.id] = m; return acc; },
  {} as Record<string, MetricDef>,
);

export const METRIC_GROUPS: MetricGroup[] = ['Sleep', 'Heart', 'Movement', 'Energy', 'Nutrition', 'Body'];

export const METRICS_BY_GROUP: Record<MetricGroup, MetricDef[]> = METRIC_GROUPS.reduce(
  (acc, g) => { acc[g] = METRICS.filter((m) => m.group === g); return acc; },
  {} as Record<MetricGroup, MetricDef[]>,
);

// Quick presets — one-click metric combinations.
export interface Preset {
  id: string;
  label: string;
  metricIds: string[];
}

export const PRESETS: Preset[] = [
  {
    id: 'recovery',
    label: 'Recovery',
    metricIds: ['sleep_score', 'hrv_ms', 'resting_hr'],
  },
  {
    id: 'training',
    label: 'Training',
    metricIds: ['total_steps', 'active_minutes', 'vigorous_minutes'],
  },
  {
    id: 'cut',
    label: 'Cut tracking',
    metricIds: ['weight', 'calories_consumed', 'protein_consumed'],
  },
  {
    id: 'blueprint',
    label: 'Bryan Blueprint',
    metricIds: ['sleep_score', 'hrv_ms', 'resting_hr', 'vo2max', 'total_steps'],
  },
];

export const MAX_SELECTED_METRICS = 6;

// Re-export so consumer code can ask for "today's goal".
export { goalForDate };
