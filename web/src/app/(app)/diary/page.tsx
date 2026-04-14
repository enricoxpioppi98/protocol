'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DateStrip } from '@/components/ui/DateStrip';
import { MacroSummaryCard } from '@/components/diary/MacroSummaryCard';
import { MealSection } from '@/components/diary/MealSection';
import { StreakBanner } from '@/components/diary/StreakBanner';
import { EditEntryModal } from '@/components/diary/EditEntryModal';
import { UtensilsCrossed } from 'lucide-react';
import { useDiary } from '@/lib/hooks/useDiary';
import { useGoals } from '@/lib/hooks/useGoals';
import { entriesTotals } from '@/lib/utils/macros';
import { formatDisplayDate, isToday, calculateStreak } from '@/lib/utils/dates';
import type { DiaryEntry, MealType } from '@/lib/types/models';
import { MEAL_TYPES } from '@/lib/types/models';

export default function DiaryPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [streak, setStreak] = useState(0);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const { entries, grouped, loading, updateEntry, deleteEntry } = useDiary(selectedDate);
  const { getGoalForDate } = useGoals();

  const goal = getGoalForDate(selectedDate);
  const totals = entriesTotals(entries);

  // Fetch all distinct diary entry dates and compute streak
  useEffect(() => {
    async function fetchStreak() {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('date')
        .is('deleted_at', null);

      if (!error && data) {
        const dates = data.map((row: { date: string }) => row.date);
        setStreak(calculateStreak(dates));
      }
    }
    fetchStreak();
  }, [supabase, entries]);

  function handleAddFood(mealType: MealType) {
    router.push(`/food-search?meal=${mealType}&date=${selectedDate.toISOString()}`);
  }

  function handleEditEntry(entry: DiaryEntry) {
    setEditingEntry(entry);
  }

  function handleSaveEntry(id: string, updates: { meal_type?: MealType; number_of_servings?: number }) {
    updateEntry(id, updates);
  }

  return (
    <div className="space-y-5">
      {/* Date strip */}
      <DateStrip selectedDate={selectedDate} onSelect={setSelectedDate} />

      {/* Date label */}
      <div className="text-center text-sm font-medium text-muted">
        {formatDisplayDate(selectedDate)}
      </div>

      {/* Streak banner */}
      <StreakBanner
        streak={streak}
        calories={totals.calories}
        calorieGoal={goal?.calories ?? 2000}
      />

      {/* Macro summary */}
      <MacroSummaryCard
        calories={totals.calories}
        protein={totals.protein}
        carbs={totals.carbs}
        fat={totals.fat}
        calorieGoal={goal?.calories ?? 2000}
        proteinGoal={goal?.protein ?? 150}
        carbsGoal={goal?.carbs ?? 250}
        fatGoal={goal?.fat ?? 65}
      />

      {/* Meal sections */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-3">
          {entries.length === 0 && (
            <div className="rounded-2xl bg-card px-6 py-8 text-center">
              <UtensilsCrossed size={32} className="mx-auto mb-3 text-muted/50" />
              <p className="font-semibold text-foreground">No entries yet</p>
              <p className="mt-1 text-sm text-muted">
                Tap &lsquo;Add Food&rsquo; below to start tracking
              </p>
            </div>
          )}
          {MEAL_TYPES.map((mealType) => (
            <MealSection
              key={mealType}
              mealType={mealType}
              entries={grouped[mealType]}
              onAddFood={handleAddFood}
              onDeleteEntry={deleteEntry}
              onEditEntry={handleEditEntry}
            />
          ))}
        </div>
      )}

      {/* Edit entry modal */}
      {editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          onSave={handleSaveEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
