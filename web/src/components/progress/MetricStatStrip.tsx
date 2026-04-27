'use client';

import type { MetricDef } from './metricCatalog';
import type { MultiMetricChartDatum } from './MultiMetricChart';

interface Props {
  metrics: MetricDef[];
  data: MultiMetricChartDatum[];
}

interface Summary {
  count: number;
  min: number;
  max: number;
  avg: number;
  last7: number | null;
}

function summarize(metric: MetricDef, data: MultiMetricChartDatum[]): Summary {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;

  // Last-7-days window: assumes data is sorted ascending by date.
  const last7Slice = data.slice(-7);
  let last7Sum = 0;
  let last7Count = 0;

  for (const d of data) {
    const v = d[metric.id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count += 1;
    }
  }
  for (const d of last7Slice) {
    const v = d[metric.id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      last7Sum += v;
      last7Count += 1;
    }
  }

  return {
    count,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    avg: count > 0 ? sum / count : 0,
    last7: last7Count > 0 ? last7Sum / last7Count : null,
  };
}

function fmt(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (unit === '%' || unit === 'min' || unit === 'bpm' || unit === 'ms' || unit === 'kcal') {
    return v.toFixed(0);
  }
  if (Number.isInteger(v)) return v.toFixed(0);
  return v.toFixed(1);
}

export function MetricStatStrip({ metrics, data }: Props) {
  if (metrics.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((m) => {
        const s = summarize(m, data);
        return (
          <div key={m.id} className="rounded-2xl bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: m.color }}
                />
                <span className="text-xs font-medium text-foreground">{m.label}</span>
              </div>
              <span className="text-[10px] text-muted">
                {s.count} {s.count === 1 ? 'day' : 'days'}
              </span>
            </div>
            {s.count === 0 ? (
              <div className="mt-2 text-sm text-muted">No data</div>
            ) : (
              <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                <Stat label="Min"  value={fmt(s.min, m.unit)} unit={m.unit} />
                <Stat label="Avg"  value={fmt(s.avg, m.unit)} unit={m.unit} />
                <Stat label="Max"  value={fmt(s.max, m.unit)} unit={m.unit} />
                <Stat label="L7"   value={s.last7 == null ? '—' : fmt(s.last7, m.unit)} unit={m.unit} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
        {value !== '—' && unit && (
          <span className="ml-0.5 text-[10px] font-normal text-muted">{unit}</span>
        )}
      </div>
    </div>
  );
}
