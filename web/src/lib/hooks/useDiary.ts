'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { DiaryEntry, MealType } from '@/lib/types/models';
import { formatDate } from '@/lib/utils/dates';

export function useDiary(selectedDate: Date) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const dateStr = formatDate(selectedDate);

    const { data, error } = await supabase
      .from('diary_entries')
      .select('*, food:foods(*), recipe:recipes(*, ingredients:recipe_ingredients(*, food:foods(*)))')
      .eq('date', dateStr)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setEntries(data as DiaryEntry[]);
    }
    setLoading(false);
  }, [selectedDate, supabase]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Realtime subscription — refetch when diary_entries change from another device
  useEffect(() => {
    const channel = supabase
      .channel('diary_entries_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'diary_entries' },
        () => {
          fetchEntries();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchEntries]);

  const addEntry = useCallback(
    async (params: {
      food_id?: string;
      recipe_id?: string;
      meal_type: MealType;
      number_of_servings: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('diary_entries').insert({
        user_id: user.id,
        date: formatDate(selectedDate),
        meal_type: params.meal_type,
        number_of_servings: params.number_of_servings,
        food_id: params.food_id ?? null,
        recipe_id: params.recipe_id ?? null,
      });

      if (!error) fetchEntries();
    },
    [selectedDate, supabase, fetchEntries]
  );

  const updateEntry = useCallback(
    async (id: string, updates: { meal_type?: MealType; number_of_servings?: number }) => {
      const { error } = await supabase
        .from('diary_entries')
        .update(updates)
        .eq('id', id);

      if (!error) fetchEntries();
    },
    [supabase, fetchEntries]
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('diary_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
      }
    },
    [supabase]
  );

  const grouped = {
    Breakfast: entries.filter((e) => e.meal_type === 'Breakfast'),
    Lunch: entries.filter((e) => e.meal_type === 'Lunch'),
    Dinner: entries.filter((e) => e.meal_type === 'Dinner'),
    Snacks: entries.filter((e) => e.meal_type === 'Snacks'),
  };

  return { entries, grouped, loading, addEntry, updateEntry, deleteEntry, refetch: fetchEntries };
}
