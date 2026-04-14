'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { WeightEntry } from '@/lib/types/models';
import { colors } from '@/lib/constants/theme';

interface WeightChartProps {
  entries: WeightEntry[];
}

export function WeightChart({ entries }: WeightChartProps) {
  if (entries.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl bg-card text-sm text-muted">
        Log at least 2 weigh-ins to see your trend
      </div>
    );
  }

  const data = entries.map((e) => ({
    date: e.date,
    weight: e.weight,
  }));

  const weights = entries.map((e) => e.weight);
  const minW = Math.floor(Math.min(...weights) - 2);
  const maxW = Math.ceil(Math.max(...weights) + 2);

  return (
    <div className="rounded-2xl bg-card p-4">
      <h3 className="mb-3 font-semibold">Weight Trend</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <defs>
            <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent} stopOpacity={0.3} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => format(parseISO(d), 'M/d')}
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[minW, maxW]}
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(28,28,30)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              fontSize: '13px',
            }}
            labelFormatter={(d) => format(parseISO(d as string), 'MMM d, yyyy')}
            formatter={(value) => [`${Number(value).toFixed(1)} lbs`, 'Weight']}
          />
          <Area
            type="monotone"
            dataKey="weight"
            fill="url(#weightGrad)"
            stroke="none"
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke={colors.accent}
            strokeWidth={2.5}
            dot={{ r: 3, fill: colors.accent }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
