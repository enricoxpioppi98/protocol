// Port of GoalSuggestionService.swift
import type { WeightEntry, DiaryEntry, DailyGoal } from '@/lib/types/models';
import { entryCalories } from './macros';

export interface GoalSuggestion {
  message: string;
  detail: string;
  type: 'warning' | 'success' | 'info';
}

export function generateGoalSuggestion(
  weightEntries: WeightEntry[],
  diaryEntries: DiaryEntry[],
  goal: DailyGoal | null
): GoalSuggestion | null {
  if (!goal) return null;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

  // Need at least 7 weight entries in last 30 days
  const recentWeights = weightEntries
    .filter((w) => new Date(w.date) >= thirtyDaysAgo)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (recentWeights.length < 7) return null;

  // Need at least 5 unique days of diary entries in last 14 days
  const recentDiary = diaryEntries.filter((e) => new Date(e.date) >= fourteenDaysAgo);
  const uniqueDays = new Set(recentDiary.map((e) => e.date));
  if (uniqueDays.size < 5) return null;

  const firstWeight = recentWeights[0];
  const lastWeight = recentWeights[recentWeights.length - 1];
  if (firstWeight.id === lastWeight.id) return null;

  const daySpan = Math.round(
    (new Date(lastWeight.date).getTime() - new Date(firstWeight.date).getTime()) / (24 * 3600 * 1000)
  );
  if (daySpan < 7) return null;

  const totalChange = lastWeight.weight - firstWeight.weight;
  const weeklyChange = totalChange / (daySpan / 7);

  // Average daily calories
  const dailyTotals: number[] = [];
  for (const day of uniqueDays) {
    const dayEntries = recentDiary.filter((e) => e.date === day);
    const total = dayEntries.reduce((sum, e) => sum + entryCalories(e), 0);
    if (total > 0) dailyTotals.push(total);
  }
  if (dailyTotals.length === 0) return null;

  const avgCalories = dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length;
  const calorieDiff = avgCalories - goal.calories;

  if (weeklyChange < -2.0) {
    return {
      message: 'Rapid weight loss detected',
      detail: `You're losing ${Math.abs(weeklyChange).toFixed(1)} lbs/week. Consider adding ~200 cal/day to preserve muscle mass.`,
      type: 'warning',
    };
  } else if (weeklyChange < -0.5) {
    return {
      message: 'Great progress!',
      detail: `You're losing ${Math.abs(weeklyChange).toFixed(1)} lbs/week — a healthy, sustainable rate.`,
      type: 'success',
    };
  } else if (weeklyChange >= -0.3 && weeklyChange <= 0.3) {
    if (calorieDiff > 100) {
      return {
        message: 'Weight is stable',
        detail: `You're averaging ${Math.round(avgCalories)} cal/day (goal: ${Math.round(goal.calories)}). Reduce by ~150 cal to start losing.`,
        type: 'info',
      };
    } else if (calorieDiff < -200) {
      return {
        message: 'Eating under goal',
        detail: `You're averaging ${Math.round(avgCalories)} cal/day — ${Math.round(Math.abs(calorieDiff))} below goal. Your weight is stable, which is positive.`,
        type: 'info',
      };
    }
    return null;
  } else if (weeklyChange > 0.3) {
    if (calorieDiff > 200) {
      return {
        message: 'Above calorie goal',
        detail: `You're gaining ${weeklyChange.toFixed(1)} lbs/week and averaging ${Math.round(calorieDiff)} cal above goal. Try staying closer to target.`,
        type: 'warning',
      };
    } else {
      return {
        message: 'Gradual weight gain',
        detail: `You're gaining ${weeklyChange.toFixed(1)} lbs/week. If this isn't intentional, consider reducing by ~100–200 cal.`,
        type: 'warning',
      };
    }
  }

  return null;
}
