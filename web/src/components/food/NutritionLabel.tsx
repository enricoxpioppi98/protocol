'use client';

import { cn } from '@/lib/utils/cn';

interface NutritionLabelProps {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  className?: string;
}

export function NutritionLabel({ calories, protein, carbs, fat, className }: NutritionLabelProps) {
  return (
    <div className={cn('flex justify-between rounded-xl bg-background px-4 py-3 text-sm', className)}>
      <div className="text-center">
        <div className="font-bold tabular-nums text-highlight">{Math.round(calories)}</div>
        <div className="text-[10px] text-muted">cal</div>
      </div>
      <div className="text-center">
        <div className="font-bold tabular-nums text-accent">{Math.round(protein * 10) / 10}g</div>
        <div className="text-[10px] text-muted">protein</div>
      </div>
      <div className="text-center">
        <div className="font-bold tabular-nums text-highlight">{Math.round(carbs * 10) / 10}g</div>
        <div className="text-[10px] text-muted">carbs</div>
      </div>
      <div className="text-center">
        <div className="font-bold tabular-nums text-fat">{Math.round(fat * 10) / 10}g</div>
        <div className="text-[10px] text-muted">fat</div>
      </div>
    </div>
  );
}
