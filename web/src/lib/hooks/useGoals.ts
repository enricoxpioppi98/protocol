'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { DailyGoal } from '@/lib/types/models';
import { goalForDate } from '@/lib/utils/macros';

export function useGoals() {
  const [goals, setGoals] = useState<DailyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const fetchGoals = useCallback(async () => {
    const { data, error } = await supabase
      .from('daily_goals')
      .select('*')
      .order('day_of_week', { ascending: true });

    if (!error && data) {
      setGoals(data as DailyGoal[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const getGoalForDate = useCallback(
    (date: Date) => goalForDate(goals, date),
    [goals]
  );

  const updateGoal = useCallback(
    async (id: string, updates: Partial<Pick<DailyGoal, 'calories' | 'protein' | 'carbs' | 'fat'>>) => {
      const { error } = await supabase
        .from('daily_goals')
        .update(updates)
        .eq('id', id);

      if (!error) fetchGoals();
    },
    [supabase, fetchGoals]
  );

  const createDayOverride = useCallback(
    async (dayOfWeek: number, baseGoal: DailyGoal) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('daily_goals').insert({
        user_id: user.id,
        calories: baseGoal.calories,
        protein: baseGoal.protein,
        carbs: baseGoal.carbs,
        fat: baseGoal.fat,
        day_of_week: dayOfWeek,
      });

      if (!error) fetchGoals();
    },
    [supabase, fetchGoals]
  );

  const deleteDayOverride = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('daily_goals')
        .delete()
        .eq('id', id);

      if (!error) fetchGoals();
    },
    [supabase, fetchGoals]
  );

  return { goals, loading, getGoalForDate, updateGoal, createDayOverride, deleteDayOverride, refetch: fetchGoals };
}
