'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useGoals } from '@/lib/hooks/useGoals';
import { MacroChart } from '@/components/progress/MacroChart';
import { StatCard } from '@/components/progress/StatCard';
import { GoalSuggestionBanner } from '@/components/progress/GoalSuggestionBanner';
import { generateGoalSuggestion } from '@/lib/utils/goalSuggestion';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';
import { entryCalories, entryProtein, entryCarbs, entryFat, entryFiber } from '@/lib/utils/macros';
import type { DiaryEntry } from '@/lib/types/models';

type TimeRange = '7D' | '30D' | '90D';
const rangeDays: Record<TimeRange, number> = { '7D': 7, '30D': 30, '90D': 90 };

export default function ProgressPage() {
  const [range, setRange] = useState<TimeRange>('30D');
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  const { getGoalForDate } = useGoals();
  const goal = getGoalForDate(new Date());
  const supabase = useMemo(() => createClient(), []);
  const days = rangeDays[range];

  // Fetch diary entries for charts
  const fetchDiary = useCallback(async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const { data } = await supabase
      .from('diary_entries')
      .select('*, food:foods(*), recipe:recipes(*, ingredients:recipe_ingredients(*, food:foods(*)))')
      .gte('date', cutoff.toISOString().split('T')[0])
      .is('deleted_at', null);

    if (data) setDiaryEntries(data as DiaryEntry[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchDiary();
  }, [fetchDiary]);

  // Check dismissed state
  useEffect(() => {
    const dismissed = localStorage.getItem('suggestion_dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      if (Date.now() - dismissedTime < 7 * 24 * 3600 * 1000) {
        setSuggestionDismissed(true);
      }
    }
  }, []);

  // Build daily totals for the selected range
  const dailyTotals = useMemo(() => {
    const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000);
    const totalsMap: Record<string, { calories: number; protein: number; carbs: number; fat: number; fiber: number }> = {};

    for (const entry of diaryEntries) {
      if (new Date(entry.date) < cutoffDate) continue;
      const dateStr = entry.date;
      if (!totalsMap[dateStr]) {
        totalsMap[dateStr] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      }
      totalsMap[dateStr].calories += entryCalories(entry);
      totalsMap[dateStr].protein += entryProtein(entry);
      totalsMap[dateStr].carbs += entryCarbs(entry);
      totalsMap[dateStr].fat += entryFat(entry);
      totalsMap[dateStr].fiber += entryFiber(entry);
    }

    return totalsMap;
  }, [diaryEntries, days]);

  // Calculate averages from days that have data
  const averages = useMemo(() => {
    const dayKeys = Object.keys(dailyTotals);
    const count = dayKeys.length;
    if (count === 0) return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

    const sums = dayKeys.reduce(
      (acc, key) => ({
        calories: acc.calories + dailyTotals[key].calories,
        protein: acc.protein + dailyTotals[key].protein,
        carbs: acc.carbs + dailyTotals[key].carbs,
        fat: acc.fat + dailyTotals[key].fat,
        fiber: acc.fiber + dailyTotals[key].fiber,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    return {
      calories: Math.round(sums.calories / count),
      protein: Math.round(sums.protein / count),
      carbs: Math.round(sums.carbs / count),
      fat: Math.round(sums.fat / count),
      fiber: Math.round(sums.fiber / count),
    };
  }, [dailyTotals]);

  // Daily breakdown sorted reverse chronological
  const dailyBreakdown = useMemo(() => {
    return Object.entries(dailyTotals)
      .map(([date, totals]) => ({ date, ...totals }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [dailyTotals]);

  const suggestion = !suggestionDismissed
    ? generateGoalSuggestion([], diaryEntries, goal)
    : null;

  function handleDismissSuggestion() {
    localStorage.setItem('suggestion_dismissed', Date.now().toString());
    setSuggestionDismissed(true);
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Progress</h1>

      {/* Time range picker */}
      <div className="flex gap-1 rounded-xl bg-card p-1">
        {(['7D', '30D', '90D'] as TimeRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
              range === r ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Loading / Empty state */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : diaryEntries.length === 0 ? (
        <div className="rounded-2xl bg-card px-6 py-12 text-center">
          <BarChart3 size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="font-semibold">No data yet</p>
          <p className="mt-1 text-sm text-muted">Start logging meals in the Diary to see your trends here</p>
        </div>
      ) : null}

      {/* Goal suggestion */}
      {suggestion && (
        <GoalSuggestionBanner suggestion={suggestion} onDismiss={handleDismissSuggestion} />
      )}

      {/* Stat cards - macro averages */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard
          label="Avg Calories"
          value={averages.calories > 0 ? `${averages.calories}` : '—'}
          color={colors.highlight}
        />
        <StatCard
          label="Avg Protein"
          value={averages.protein > 0 ? `${averages.protein}g` : '—'}
          color={colors.accent}
        />
        <StatCard
          label="Avg Carbs"
          value={averages.carbs > 0 ? `${averages.carbs}g` : '—'}
          color={colors.highlight}
        />
        <StatCard
          label="Avg Fat"
          value={averages.fat > 0 ? `${averages.fat}g` : '—'}
          color={colors.fat}
        />
        <StatCard
          label="Avg Fiber"
          value={averages.fiber > 0 ? `${averages.fiber}g` : '—'}
          color={colors.fiber}
        />
      </div>

      {/* Macro chart */}
      <MacroChart entries={diaryEntries} goal={goal} days={days} height={280} />

      {/* Daily Breakdown */}
      {dailyBreakdown.length > 0 && (
        <div className="rounded-2xl bg-card">
          <div className="px-4 py-3">
            <h3 className="font-semibold">Daily Breakdown</h3>
          </div>
          <div className="border-t border-border">
            {dailyBreakdown.map((day) => (
              <div
                key={day.date}
                className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <span className="text-sm font-medium">
                  {format(parseISO(day.date), 'MMM d')}
                </span>
                <div className="flex items-center gap-3 text-sm tabular-nums">
                  <span className="text-highlight">{Math.round(day.calories)}</span>
                  <span className="text-accent">{Math.round(day.protein)}P</span>
                  <span className="text-highlight">{Math.round(day.carbs)}C</span>
                  <span className="text-fat">{Math.round(day.fat)}F</span>
                  <span className="text-fiber">{Math.round(day.fiber)}Fi</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
