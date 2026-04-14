'use client';

import { useState, useRef } from 'react';
import { Sunrise, Sun, Moon, Cookie, Plus, Trash2 } from 'lucide-react';
import type { DiaryEntry, MealType } from '@/lib/types/models';
import { entryCalories, entryProtein, entryCarbs, entryFat, entryName } from '@/lib/utils/macros';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';

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
            <SwipeToDelete key={entry.id} onDelete={() => onDeleteEntry(entry.id)}>
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => onEditEntry(entry)}
                  className="flex flex-1 flex-col gap-0.5 text-left"
                >
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
                </div>
              </div>
            </SwipeToDelete>
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

// MARK: - Swipe to Delete

function SwipeToDelete({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const decided = useRef(false);
  const threshold = 80;

  function handleTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    tracking.current = true;
    decided.current = false;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!tracking.current) return;
    const dx = startX.current - e.touches[0].clientX;
    const dy = Math.abs(e.touches[0].clientY - startY.current);

    // Decide direction on first significant move
    if (!decided.current && (Math.abs(dx) > 5 || dy > 5)) {
      decided.current = true;
      if (dy > Math.abs(dx)) {
        // Vertical scroll — bail out
        tracking.current = false;
        setOffset(0);
        return;
      }
    }

    if (decided.current && tracking.current) {
      // Horizontal swipe — prevent page scroll
      e.preventDefault();
      setOffset(Math.max(0, Math.min(dx, 120)));
    }
  }

  function handleTouchEnd() {
    tracking.current = false;
    decided.current = false;
    if (offset >= threshold) {
      setOffset(300);
      setTimeout(() => onDelete(), 200);
    } else {
      setOffset(0);
    }
  }

  return (
    <div className="relative overflow-hidden border-b border-border last:border-b-0">
      {/* Delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center bg-danger px-6"
        style={{ opacity: Math.min(offset / threshold, 1) }}
      >
        <Trash2 size={18} className="text-white" />
      </div>

      {/* Swipeable content */}
      <div
        className="relative bg-card select-none"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: tracking.current ? 'none' : 'transform 0.25s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
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
