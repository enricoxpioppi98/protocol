'use client';

import { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { DiaryEntry, DailyGoal } from '@/lib/types/models';
import { entryCalories, entryProtein, entryCarbs, entryFat } from '@/lib/utils/macros';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';

type MacroTab = 'calories' | 'protein' | 'carbs' | 'fat';

interface MacroChartProps {
  entries: DiaryEntry[];
  goal: DailyGoal | null;
  days: number;
  height?: number;
}

const tabConfig: Record<MacroTab, { label: string; color: string; goalKey: keyof DailyGoal; unit: string }> = {
  calories: { label: 'Calories', color: colors.highlight, goalKey: 'calories', unit: '' },
  protein: { label: 'Protein', color: colors.accent, goalKey: 'protein', unit: 'g' },
  carbs: { label: 'Carbs', color: colors.highlight, goalKey: 'carbs', unit: 'g' },
  fat: { label: 'Fat', color: colors.fat, goalKey: 'fat', unit: 'g' },
};

export function MacroChart({ entries, goal, days, height = 280 }: MacroChartProps) {
  const [tab, setTab] = useState<MacroTab>('calories');
  const config = tabConfig[tab];

  const macroFns: Record<MacroTab, (e: DiaryEntry) => number> = {
    calories: entryCalories,
    protein: entryProtein,
    carbs: entryCarbs,
    fat: entryFat,
  };

  // Build daily data
  const data: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dayEntries = entries.filter((e) => e.date === dateStr);
    const total = dayEntries.reduce((sum, e) => sum + macroFns[tab](e), 0);
    if (total > 0) {
      data.push({ date: dateStr, value: Math.round(total) });
    }
  }

  const avg = data.length > 0 ? data.reduce((s, d) => s + d.value, 0) / data.length : 0;
  const goalValue = goal ? (goal[config.goalKey] as number) : 0;

  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Daily Macros</h3>
        <span className="text-xs text-muted">
          Avg: {Math.round(avg)}{config.unit}
        </span>
      </div>

      {/* Tab selector */}
      <div className="mb-4 flex gap-1 rounded-xl bg-background p-1">
        {(Object.keys(tabConfig) as MacroTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
              tab === t ? 'bg-card text-foreground' : 'text-muted hover:text-foreground'
            )}
          >
            {tabConfig[t].label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => format(parseISO(d), 'M/d')}
              stroke="var(--app-chart-axis)"
              tick={{ fontSize: 10 }}
            />
            <YAxis
              stroke="var(--app-chart-axis)"
              tick={{ fontSize: 11 }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--app-chart-tooltip-bg)',
                border: '1px solid var(--app-chart-tooltip-border)',
                borderRadius: '12px',
                fontSize: '13px',
                color: 'var(--app-fg)',
              }}
              labelFormatter={(d) => format(parseISO(d as string), 'MMM d')}
              formatter={(value) => [`${value}${config.unit}`, config.label]}
            />
            {goalValue > 0 && (
              <ReferenceLine
                y={goalValue}
                stroke="var(--app-muted)"
                strokeDasharray="5 5"
                label={{ value: `Goal: ${goalValue}`, position: 'right', fontSize: 10, fill: 'var(--app-muted)' }}
              />
            )}
            <Bar dataKey="value" fill={config.color} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
