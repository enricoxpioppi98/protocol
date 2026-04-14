'use client';

import { ProgressRing } from '@/components/ui/ProgressRing';
import { colors } from '@/lib/constants/theme';

interface MacroSummaryCardProps {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  calorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

export function MacroSummaryCard({
  calories,
  protein,
  carbs,
  fat,
  calorieGoal,
  proteinGoal,
  carbsGoal,
  fatGoal,
}: MacroSummaryCardProps) {
  const remaining = Math.max(calorieGoal - calories, 0);

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="flex flex-col items-center gap-5">
        {/* Main calorie ring */}
        <ProgressRing
          value={calories}
          goal={calorieGoal}
          size={160}
          strokeWidth={14}
          color={colors.highlight}
        >
          <div className="flex flex-col items-center">
            <span className="text-3xl font-bold tabular-nums">{Math.round(calories)}</span>
            <span className="text-xs text-muted">/ {Math.round(calorieGoal)} cal</span>
            <span
              className="mt-0.5 text-[10px] font-medium"
              style={{ color: remaining > 0 ? colors.highlight : 'rgb(255, 69, 58)' }}
            >
              {Math.round(remaining)} left
            </span>
          </div>
        </ProgressRing>

        {/* Mini macro rings */}
        <div className="flex gap-8">
          <MiniRing label="P" value={protein} goal={proteinGoal} color={colors.accent} />
          <MiniRing label="C" value={carbs} goal={carbsGoal} color={colors.highlight} />
          <MiniRing label="F" value={fat} goal={fatGoal} color={colors.fat} />
        </div>

        {/* Progress bars */}
        <div className="flex w-full flex-col gap-2">
          <MacroBar label="Protein" value={protein} goal={proteinGoal} color={colors.accent} />
          <MacroBar label="Carbs" value={carbs} goal={carbsGoal} color={colors.highlight} />
          <MacroBar label="Fat" value={fat} goal={fatGoal} color={colors.fat} />
        </div>
      </div>
    </div>
  );
}

function MiniRing({
  label,
  value,
  goal,
  color,
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
}) {
  const remaining = Math.max(goal - value, 0);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <ProgressRing value={value} goal={goal} size={50} strokeWidth={6} color={color}>
        <span className="text-[11px] font-bold tabular-nums">{Math.round(value)}</span>
      </ProgressRing>
      <div className="flex flex-col items-center">
        <span className="text-[10px] text-muted">
          {label}: {Math.round(goal)}g
        </span>
        <span
          className="text-[9px] font-medium"
          style={{ color: remaining > 0 ? color : 'rgb(255, 69, 58)' }}
        >
          {Math.round(remaining)}g left
        </span>
      </div>
    </div>
  );
}

function MacroBar({
  label,
  value,
  goal,
  color,
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
}) {
  const progress = goal > 0 ? Math.min(value / goal, 1) : 0;
  const remaining = Math.max(goal - value, 0);

  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-xs text-muted">{label}</span>
      <div className="flex-1">
        <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: `${color}22` }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress * 100}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <span className="w-16 text-right text-xs tabular-nums text-muted">
        {Math.round(remaining)}g left
      </span>
    </div>
  );
}
