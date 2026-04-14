'use client';

import { useState, useRef, useCallback } from 'react';
import { Sunrise, Sun, Moon, Cookie, Plus, Trash2 } from 'lucide-react';
import type { DiaryEntry, MealType } from '@/lib/types/models';
import { entryCalories, entryProtein, entryCarbs, entryFat, entryName } from '@/lib/utils/macros';
import { colors } from '@/lib/constants/theme';

const mealIcons: Record<MealType, React.ElementType> = {
  Breakfast: Sunrise,
  Lunch: Sun,
  Dinner: Moon,
  Snacks: Cookie,
};

interface MealSectionProps {
  mealType: MealType;
  entries: DiaryEntry[];
  onAddFood: (mealType: MealType) => void;
  onDeleteEntry: (id: string) => void;
  onEditEntry: (entry: DiaryEntry) => void;
}

export function MealSection({ mealType, entries, onAddFood, onDeleteEntry, onEditEntry }: MealSectionProps) {
  const Icon = mealIcons[mealType];
  const totalCal = entries.reduce((sum, e) => sum + entryCalories(e), 0);
  const totalProtein = entries.reduce((sum, e) => sum + entryProtein(e), 0);

  return (
    <div className="rounded-2xl bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Icon size={18} className="text-accent" />
          <span className="font-semibold">{mealType}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="tabular-nums">{Math.round(totalCal)} cal</span>
          <span className="tabular-nums" style={{ color: colors.accent }}>
            {Math.round(totalProtein)}g P
          </span>
        </div>
      </div>

      {/* Empty hint */}
      {entries.length === 0 && (
        <p className="py-3 text-center text-xs text-muted/60">No foods logged</p>
      )}

      {/* Entries */}
      {entries.length > 0 && (
        <div className="border-t border-border">
          {entries.map((entry) => (
            <DiaryEntryRow
              key={entry.id}
              entry={entry}
              onEdit={() => onEditEntry(entry)}
              onDelete={() => onDeleteEntry(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Add button */}
      <button
        onClick={() => onAddFood(mealType)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm text-accent transition-colors hover:bg-accent/5"
      >
        <Plus size={16} />
        Add Food
      </button>
    </div>
  );
}

function DiaryEntryRow({ entry, onEdit, onDelete }: { entry: DiaryEntry; onEdit: () => void; onDelete: () => void }) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const direction = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const didSwipe = useRef(false);
  const animating = useRef(false);
  const threshold = 70;

  const reset = useCallback(() => {
    animating.current = true;
    setOffset(0);
    setTimeout(() => { animating.current = false; }, 250);
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    if (animating.current) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    direction.current = 'none';
    didSwipe.current = false;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (animating.current) return;
    const dx = startX.current - e.touches[0].clientX;
    const dy = e.touches[0].clientY - startY.current;

    // Lock direction on first significant move
    if (direction.current === 'none') {
      if (Math.abs(dx) > 8) {
        direction.current = 'horizontal';
        didSwipe.current = true;
      } else if (Math.abs(dy) > 8) {
        direction.current = 'vertical';
        return;
      } else {
        return;
      }
    }

    if (direction.current === 'vertical') return;

    // Only swipe left (positive dx)
    setOffset(Math.max(0, Math.min(dx, 100)));
  }

  function onTouchEnd() {
    if (direction.current !== 'horizontal') {
      direction.current = 'none';
      return;
    }
    direction.current = 'none';

    if (offset >= threshold) {
      animating.current = true;
      setOffset(200);
      setTimeout(() => onDelete(), 200);
    } else {
      reset();
    }
  }

  return (
    <div className="relative overflow-hidden border-b border-border last:border-b-0">
      {/* Red delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center bg-danger px-5"
        style={{ opacity: Math.min(offset / threshold, 1) }}
      >
        <Trash2 size={16} className="text-white" />
      </div>

      {/* Row content */}
      <div
        className="relative bg-card"
        style={{
          transform: `translateX(${-offset}px)`,
          transition: animating.current ? 'transform 0.25s ease-out' : 'none',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { direction.current = 'none'; reset(); }}
      >
        <div className="group flex items-center justify-between px-4 py-3 hover:bg-card-hover">
          <button onClick={() => { if (!didSwipe.current) onEdit(); }} className="flex flex-1 flex-col gap-0.5 text-left">
            <span className="text-sm font-medium">{entryName(entry)}</span>
            <div className="flex gap-2 text-[11px] text-muted">
              <span>{entry.number_of_servings} serving{entry.number_of_servings !== 1 ? 's' : ''}</span>
              <span className="tabular-nums">{Math.round(entryCalories(entry))} cal</span>
            </div>
          </button>

          <div className="flex items-center gap-1.5">
            <MacroPill value={entryProtein(entry)} color={colors.accent} />
            <MacroPill value={entryCarbs(entry)} color={colors.highlight} />
            <MacroPill value={entryFat(entry)} color={colors.fat} />
            <button
              onClick={onDelete}
              className="ml-2 rounded-lg p-1.5 text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MacroPill({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {Math.round(value)}
    </span>
  );
}
