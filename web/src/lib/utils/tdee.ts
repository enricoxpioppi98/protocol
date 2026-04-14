// Port of TDEECalculatorViewModel.swift — Mifflin-St Jeor equation

export type Sex = 'male' | 'female';

export type ActivityLevel = 'sedentary' | 'lightlyActive' | 'moderatelyActive' | 'veryActive' | 'extraActive';

export const activityLevels: { key: ActivityLevel; label: string; subtitle: string; multiplier: number }[] = [
  { key: 'sedentary', label: 'Sedentary', subtitle: 'Little or no exercise', multiplier: 1.2 },
  { key: 'lightlyActive', label: 'Lightly Active', subtitle: 'Light exercise 1–3 days/week', multiplier: 1.375 },
  { key: 'moderatelyActive', label: 'Moderately Active', subtitle: 'Moderate exercise 3–5 days/week', multiplier: 1.55 },
  { key: 'veryActive', label: 'Very Active', subtitle: 'Hard exercise 6–7 days/week', multiplier: 1.725 },
  { key: 'extraActive', label: 'Extra Active', subtitle: 'Very hard exercise or physical job', multiplier: 1.9 },
];

export type GoalType = 'lose' | 'maintain' | 'gain';

export const goalTypes: { key: GoalType; label: string; adjustment: number; rationale: string }[] = [
  {
    key: 'lose',
    label: 'Lose Weight',
    adjustment: -500,
    rationale: 'Higher protein (1g/lb) preserves muscle during a deficit. Moderate fat supports hormonal health. Remaining calories from carbs for energy.',
  },
  {
    key: 'maintain',
    label: 'Maintain',
    adjustment: 0,
    rationale: 'Balanced 30/40/30 split (protein/carbs/fat by calories) supports general health, recovery, and sustained energy.',
  },
  {
    key: 'gain',
    label: 'Gain Muscle',
    adjustment: 500,
    rationale: 'Adequate protein (0.8g/lb) for muscle synthesis. Higher carbs fuel intense training. Moderate fat for overall health.',
  },
];

export const adjustmentOptions = [-500, -250, 0, 250, 500];

export interface TDEEInput {
  age: number;
  sex: Sex;
  weightLbs: number;
  heightFeet: number;
  heightInches: number;
  useMetric: boolean;
  weightKg?: number;
  heightCm?: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  calorieAdjustment: number;
  useBodyFat: boolean;
  bodyFatPercentage: number;
}

export interface MacroResult {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
}

function getMultiplier(level: ActivityLevel): number {
  return activityLevels.find((a) => a.key === level)!.multiplier;
}

export function calculateBMR(input: TDEEInput): number {
  const weightKg = input.useMetric ? (input.weightKg ?? 0) : input.weightLbs * 0.453592;
  const heightCm = input.useMetric ? (input.heightCm ?? 0) : (input.heightFeet * 12 + input.heightInches) * 2.54;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * input.age;
  return input.sex === 'male' ? base + 5 : base - 161;
}

export function calculateTDEE(input: TDEEInput): number {
  return calculateBMR(input) * getMultiplier(input.activityLevel);
}

export function calculateMacros(input: TDEEInput): MacroResult {
  const tdee = calculateTDEE(input);
  const targetCal = Math.max(tdee + input.calorieAdjustment, 0);
  const weightLbs = input.useMetric ? (input.weightKg ?? 0) / 0.453592 : input.weightLbs;
  const leanMassLbs = input.useBodyFat
    ? weightLbs * (1 - input.bodyFatPercentage / 100)
    : weightLbs;

  let protein: number;
  let fat: number;
  let carbs: number;

  switch (input.goalType) {
    case 'lose':
      protein = input.useBodyFat ? leanMassLbs * 1.1 : weightLbs * 1.0;
      fat = weightLbs * 0.35;
      carbs = Math.max((targetCal - protein * 4 - fat * 9) / 4, 0);
      break;
    case 'maintain':
      protein = (targetCal * 0.3) / 4;
      carbs = (targetCal * 0.4) / 4;
      fat = (targetCal * 0.3) / 9;
      break;
    case 'gain':
      protein = input.useBodyFat ? leanMassLbs * 1.0 : weightLbs * 0.8;
      fat = weightLbs * 0.3;
      carbs = Math.max((targetCal - protein * 4 - fat * 9) / 4, 0);
      break;
  }

  const totalCal = protein * 4 + carbs * 4 + fat * 9;
  return {
    calories: targetCal,
    protein,
    carbs,
    fat,
    proteinPercent: totalCal > 0 ? (protein * 4 / totalCal) * 100 : 0,
    carbsPercent: totalCal > 0 ? (carbs * 4 / totalCal) * 100 : 0,
    fatPercent: totalCal > 0 ? (fat * 9 / totalCal) * 100 : 0,
  };
}
