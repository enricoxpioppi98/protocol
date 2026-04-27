'use client';

import { Flame } from 'lucide-react';
import type { DailyGoal } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';

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
  const rawPct = goal > 0 ? (value / goal) * 100 : 0;
  const fillPct = Math.min(100, rawPct);
  const roundedPct = Math.round(rawPct);

  // Color buckets:
  //   < 80%   under (muted)
  //   80–110% on target (accent)
  //   > 110%  over (danger / highlight)
  let pctClass = 'text-muted';
  if (rawPct >= 110) pctClass = 'text-danger';
  else if (rawPct >= 80) pctClass = 'text-accent';

  let barClass = 'bg-accent';
  if (rawPct >= 110) barClass = 'bg-danger';

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
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-hover">
          <div
            className={cn(
              'h-full rounded-full transition-[width,background-color] duration-500 ease-out',
              barClass
            )}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <span
          className={cn(
            'w-10 text-right font-mono text-[11px] font-medium tabular-nums tabular transition-colors duration-300',
            pctClass
          )}
        >
          {roundedPct}%
        </span>
      </div>
    </div>
  );
}
