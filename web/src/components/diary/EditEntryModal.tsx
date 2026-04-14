'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { DiaryEntry, MealType } from '@/lib/types/models';
import { MEAL_TYPES } from '@/lib/types/models';
import { entryCalories, entryProtein, entryCarbs, entryFat, entryName } from '@/lib/utils/macros';
import { cn } from '@/lib/utils/cn';

interface EditEntryModalProps {
  entry: DiaryEntry;
  onSave: (id: string, updates: { meal_type?: MealType; number_of_servings?: number }) => void;
  onClose: () => void;
}

export function EditEntryModal({ entry, onSave, onClose }: EditEntryModalProps) {
  const [mealType, setMealType] = useState<MealType>(entry.meal_type);
  const [servings, setServings] = useState(entry.number_of_servings);

  // Compute macros based on current servings
  const ratio = servings / entry.number_of_servings;
  const cal = entryCalories(entry) * ratio;
  const prot = entryProtein(entry) * ratio;
  const carb = entryCarbs(entry) * ratio;
  const fatVal = entryFat(entry) * ratio;

  function handleSave() {
    onSave(entry.id, { meal_type: mealType, number_of_servings: servings });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-2xl bg-card p-6 sm:rounded-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold">Edit Entry</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover">
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 font-medium">{entryName(entry)}</p>

        {/* Meal type picker */}
        <div className="mb-4">
          <label className="mb-2 block text-sm text-muted">Meal</label>
          <div className="flex gap-1.5 rounded-xl bg-background p-1">
            {MEAL_TYPES.map((mt) => (
              <button
                key={mt}
                onClick={() => setMealType(mt)}
                className={cn(
                  'flex-1 rounded-lg py-2 text-xs font-medium transition-colors',
                  mealType === mt
                    ? 'bg-accent text-white'
                    : 'text-muted hover:text-foreground'
                )}
              >
                {mt}
              </button>
            ))}
          </div>
        </div>

        {/* Servings */}
        <div className="mb-5">
          <label className="mb-2 block text-sm text-muted">Servings</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setServings(Math.max(0.25, servings - 0.25))}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-background text-lg font-bold text-muted hover:text-foreground"
            >
              -
            </button>
            <input
              type="number"
              value={servings}
              onChange={(e) => setServings(Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              step={0.25}
              min={0.25}
              className="w-20 rounded-xl bg-background px-3 py-2 text-center text-lg font-bold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={() => setServings(servings + 0.25)}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-background text-lg font-bold text-muted hover:text-foreground"
            >
              +
            </button>
          </div>
        </div>

        {/* Live nutrition */}
        <div className="mb-5 flex justify-between rounded-xl bg-background px-4 py-3 text-sm">
          <div className="text-center">
            <div className="font-bold tabular-nums text-highlight">{Math.round(cal)}</div>
            <div className="text-[10px] text-muted">cal</div>
          </div>
          <div className="text-center">
            <div className="font-bold tabular-nums text-accent">{Math.round(prot)}g</div>
            <div className="text-[10px] text-muted">protein</div>
          </div>
          <div className="text-center">
            <div className="font-bold tabular-nums text-highlight">{Math.round(carb)}g</div>
            <div className="text-[10px] text-muted">carbs</div>
          </div>
          <div className="text-center">
            <div className="font-bold tabular-nums text-fat">{Math.round(fatVal)}g</div>
            <div className="text-[10px] text-muted">fat</div>
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className="w-full rounded-xl bg-accent py-3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
