'use client';

import { Moon, Heart, Activity, Wind } from 'lucide-react';
import type { BiometricsDaily } from '@/lib/types/models';
import { computeReadiness } from '@/lib/coach/readiness';
import { cn } from '@/lib/utils/cn';

interface Props {
  /** Most recent first or oldest first — we sort defensively. */
  rows: BiometricsDaily[];
  /** Show the last N days (default 7). */
  days?: number;
}

/**
 * Compact past-N-days strip for the BiometricsCard. Renders one row per
 * metric (sleep / HRV / RHR / stress) and one dot per day, color-coded by
 * the same recovery band as the readiness score, with the raw value below.
 *
 * Today is always the rightmost column. Missing days render as a faint dash.
 */
export function BiometricsTrend({ rows, days = 7 }: Props) {
  // Build today + days-1 prior dates, then look up each.
  const today = new Date();
  const targetDates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    targetDates.push(d.toISOString().slice(0, 10));
  }

  const byDate = new Map<string, BiometricsDaily>();
  for (const r of rows) byDate.set(r.date, r);

  const cells = targetDates.map((date) => byDate.get(date) ?? null);

  // Did we get anything besides today?
  const hasHistory = cells.slice(0, -1).some((c) => c !== null);
  if (!hasHistory) return null;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="eyebrow">Last {days}d</div>
        <div className="flex gap-[2px] font-mono text-[9px] uppercase tracking-[0.14em] text-muted/70">
          {targetDates.map((d, i) => (
            <span key={d} className="w-7 text-center">
              {i === days - 1
                ? 'TDY'
                : new Date(d)
                    .toLocaleDateString('en-US', { weekday: 'short' })
                    .slice(0, 2)
                    .toUpperCase()}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Row icon={<Moon size={11} />} label="Sleep" cells={cells} field="sleep_score" />
        <Row icon={<Activity size={11} />} label="HRV" cells={cells} field="hrv_ms" />
        <Row icon={<Heart size={11} />} label="RHR" cells={cells} field="resting_hr" />
        <Row icon={<Wind size={11} />} label="Stress" cells={cells} field="stress_avg" />
      </div>
    </div>
  );
}

const FIELD_BAND_CLASS = {
  green: 'bg-fiber/85 text-black',
  yellow: 'bg-highlight/80 text-black',
  red: 'bg-danger/80 text-white',
  unknown: 'bg-glass-3 text-muted/60',
} as const;

function Row({
  icon,
  label,
  cells,
  field,
}: {
  icon: React.ReactNode;
  label: string;
  cells: (BiometricsDaily | null)[];
  field: 'sleep_score' | 'hrv_ms' | 'resting_hr' | 'stress_avg';
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-14 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {icon}
        {label}
      </div>
      <div className="flex flex-1 justify-end gap-[2px]">
        {cells.map((c, i) => {
          const value = c ? (c[field] as number | null | undefined) ?? null : null;
          const band = c ? subBandFor(field, c) : 'unknown';
          return (
            <div
              key={i}
              className={cn(
                'flex h-6 w-7 items-center justify-center rounded-[4px] font-mono text-[10px] font-medium tabular-nums transition-colors',
                FIELD_BAND_CLASS[band]
              )}
              title={c ? `${c.date}: ${value ?? '—'}` : 'no data'}
            >
              {value ?? '—'}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Per-metric band: re-uses the readiness math but only looks at the one
 * relevant subscore for the cell color, so a great-sleep day still shows
 * green on the sleep row even if HRV was off.
 */
function subBandFor(
  field: 'sleep_score' | 'hrv_ms' | 'resting_hr' | 'stress_avg',
  row: BiometricsDaily
): 'green' | 'yellow' | 'red' | 'unknown' {
  const r = computeReadiness(row);
  const map = {
    sleep_score: r.subscores.sleep,
    hrv_ms: r.subscores.hrv,
    resting_hr: r.subscores.rhr,
    stress_avg: r.subscores.stress,
  } as const;
  const sub = map[field];
  if (sub == null) return 'unknown';
  if (sub >= 75) return 'green';
  if (sub >= 50) return 'yellow';
  return 'red';
}
