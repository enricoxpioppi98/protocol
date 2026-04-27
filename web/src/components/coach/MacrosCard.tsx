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
    <div className="glass relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="mb-5 flex items-center gap-3">
        <Flame size={14} className="text-accent" />
        <h2 className="eyebrow">Macros / 24h</h2>
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.16em] text-muted/70">
          {Math.round(totals.calories)} / {Math.round(kcalGoal)} kcal
        </span>
      </div>

      <div className="space-y-4">
        <Bar n="01" label="Calories" value={totals.calories} goal={kcalGoal} unit="" />
        <Bar n="02" label="Protein"  value={totals.protein}  goal={pGoal}    unit="g" />
        <Bar n="03" label="Carbs"    value={totals.carbs}    goal={cGoal}    unit="g" />
        <Bar n="04" label="Fat"      value={totals.fat}      goal={fGoal}    unit="g" />
      </div>
    </div>
  );
}

function Bar({
  n,
  label,
  value,
  goal,
  unit,
}: {
  n: string;
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
  //   > 110%  over (danger)
  let pctClass = 'text-muted';
  if (rawPct >= 110) pctClass = 'text-danger';
  else if (rawPct >= 80) pctClass = 'text-accent';

  let barClass = 'bg-accent';
  if (rawPct >= 110) barClass = 'bg-danger';

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[9px] tabular-nums tracking-widest text-muted/50">
            {n}
          </span>
          <span className="font-medium tracking-wide text-foreground">{label}</span>
        </div>
        <span className="font-mono tabular-nums text-muted">
          <span className="text-foreground">{Math.round(value)}</span>
          {unit && <span className="text-muted/70">{unit}</span>}
          <span className="mx-1.5 text-muted/40">/</span>
          {Math.round(goal)}
          {unit && <span className="text-muted/70">{unit}</span>}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-glass-3">
          {/* tick marks @ 25/50/75 */}
          {[25, 50, 75].map((t) => (
            <span
              key={t}
              aria-hidden
              className="absolute top-0 h-full w-px bg-border-strong/0"
              style={{ left: `${t}%` }}
            />
          ))}
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
            'w-12 text-right font-mono text-[11px] tabular-nums transition-colors duration-300',
            pctClass
          )}
        >
          {roundedPct}
          <span className="ml-0.5 text-muted/60">%</span>
        </span>
      </div>
    </div>
  );
}
