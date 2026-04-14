'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { WeightEntry } from '@/lib/types/models';

export function useWeightEntries() {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const fetchEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from('weight_entries')
      .select('*')
      .is('deleted_at', null)
      .order('date', { ascending: true });

    if (!error && data) {
      setEntries(data as WeightEntry[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const addEntry = useCallback(
    async (weight: number, note: string, date?: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('weight_entries').insert({
        user_id: user.id,
        date: date ?? new Date().toISOString().split('T')[0],
        weight,
        note,
      });

      if (!error) fetchEntries();
    },
    [supabase, fetchEntries]
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('weight_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
      }
    },
    [supabase]
  );

  return { entries, loading, addEntry, deleteEntry, refetch: fetchEntries };
}
