'use client';

import { Flame } from 'lucide-react';
import type { DailyGoal } from '@/lib/types/models';

interface Props {
  totals: { calories: number; protein: number; carbs: number; fat: number };
  goal: DailyGoal | null;
}

export function MacrosCard({ totals, goal }: Props) {
  const kcalGoal = goal?.calories ?? 2000;
  const pGoal = goal?.protein ?? 150;
  const cGoal = goal?.carbs ?? 250;
  const fGoal = goal?.fat ?? 65;

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Flame size={18} className="text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Today&rsquo;s macros
        </h2>
      </div>

      <div className="space-y-3">
        <Bar label="Calories" value={totals.calories} goal={kcalGoal} unit="" />
        <Bar label="Protein" value={totals.protein} goal={pGoal} unit="g" />
        <Bar label="Carbs" value={totals.carbs} goal={cGoal} unit="g" />
        <Bar label="Fat" value={totals.fat} goal={fGoal} unit="g" />
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  goal,
  unit,
}: {
  label: string;
  value: number;
  goal: number;
  unit: string;
}) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-mono tabular-nums text-muted">
          {Math.round(value)}
          {unit} / {Math.round(goal)}
          {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-card-hover">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
