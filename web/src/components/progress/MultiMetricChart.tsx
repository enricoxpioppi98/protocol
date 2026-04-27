'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { MetricDef } from './metricCatalog';

export interface MultiMetricChartDatum {
  date: string;
  // metric id -> raw value (or null/undefined if missing)
  [metricId: string]: string | number | null | undefined;
}

interface Props {
  data: MultiMetricChartDatum[];
  metrics: MetricDef[];
  /**
   * Y-axis strategy:
   *  - 'multi-axis': up to 3 series share the LEFT axis, the next 3 share the RIGHT axis.
   *    Honest scaling (each axis spans the actual range), but ≤2 axes total so the chart
   *    still reads cleanly. We default to this for ≤6 metrics.
   *  - 'normalized': every series rescaled to 0–100 (min/max within the visible range).
   *    Comparable across units, less honest about magnitude.
   *
   * The picker caps selection at 6, so 'multi-axis' covers the whole range; 'normalized'
   * is wired up as a fall-back that the parent can request explicitly.
   */
  mode: 'multi-axis' | 'normalized';
  height?: number;
}

export function MultiMetricChart({ data, metrics, mode, height = 360 }: Props) {
  if (metrics.length === 0) {
    return (
      <div
        className="glass flex flex-col items-center justify-center rounded-2xl text-sm text-muted"
        style={{ height }}
      >
        <p className="font-serif text-xl text-foreground">
          Pick a metric to start.
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          biometrics · nutrition · body comp
        </p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className="glass flex items-center justify-center rounded-2xl font-serif italic text-muted"
        style={{ height }}
      >
        No data for this period yet
      </div>
    );
  }

  // ---- Normalize series if requested ----------------------------------
  // We compute min/max per metric across the visible range, then for each
  // datum store a `<id>__norm` numeric (0–100) value the line series uses.
  const normRanges: Record<string, { min: number; max: number }> = {};
  if (mode === 'normalized') {
    for (const m of metrics) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const d of data) {
        const v = d[m.id];
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (Number.isFinite(min) && Number.isFinite(max)) {
        normRanges[m.id] = { min, max };
      }
    }
  }

  const enrichedData = data.map((d) => {
    if (mode !== 'normalized') return d;
    const next: MultiMetricChartDatum = { ...d };
    for (const m of metrics) {
      const v = d[m.id];
      const range = normRanges[m.id];
      if (typeof v === 'number' && Number.isFinite(v) && range && range.max > range.min) {
        next[`${m.id}__norm`] = ((v - range.min) / (range.max - range.min)) * 100;
      } else if (typeof v === 'number' && Number.isFinite(v) && range && range.max === range.min) {
        next[`${m.id}__norm`] = 50;
      } else {
        next[`${m.id}__norm`] = null;
      }
    }
    return next;
  });

  // ---- Multi-axis assignment -----------------------------------------
  // First 3 metrics: left axis. Next 3: right axis. (Cap is 6, so this
  // covers all picker states.)
  const leftMetrics = mode === 'multi-axis' ? metrics.slice(0, 3) : [];
  const rightMetrics = mode === 'multi-axis' ? metrics.slice(3, 6) : [];

  // Mono tick style — Bryan-Johnson terminal feel
  const tickStyle = {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    fill: 'var(--app-chart-axis)',
  } as const;

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div className="eyebrow">Trend</div>
          <h3 className="mt-0.5 font-serif text-xl leading-none tracking-tight text-foreground">
            Multi-metric <span className="italic text-muted">overlay</span>
          </h3>
        </div>
        <div className="text-right font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-muted/70">
          <div>{mode === 'multi-axis' ? 'Multi-axis' : 'Normalized 0–100'}</div>
          <div className="text-foreground">
            {String(metrics.length).padStart(2, '0')}{' '}
            {metrics.length === 1 ? 'metric' : 'metrics'}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={enrichedData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--app-chart-grid)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => format(parseISO(d as string), 'M/d')}
            stroke="var(--app-chart-axis)"
            tick={tickStyle}
            tickLine={false}
            axisLine={{ stroke: 'var(--app-chart-grid)' }}
            minTickGap={24}
          />
          {mode === 'multi-axis' ? (
            <>
              <YAxis
                yAxisId="left"
                stroke="var(--app-chart-axis)"
                tick={tickStyle}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              {rightMetrics.length > 0 && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--app-chart-axis)"
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
              )}
            </>
          ) : (
            <YAxis
              stroke="var(--app-chart-axis)"
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}`}
            />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--app-chart-axis)', strokeDasharray: '3 3' }}
            contentStyle={{
              backgroundColor: 'var(--app-chart-tooltip-bg)',
              border: '1px solid var(--app-chart-tooltip-border)',
              borderRadius: '12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--app-fg)',
              backdropFilter: 'blur(20px) saturate(160%)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              boxShadow: '0 8px 30px -12px rgba(0,0,0,0.4)',
              padding: '10px 12px',
            }}
            labelStyle={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: 'var(--app-muted)',
              marginBottom: 4,
            }}
            labelFormatter={(d) => format(parseISO(d as string), 'MMM d, yyyy')}
            formatter={(value, name) => {
              // `name` will be the dataKey of the line — for normalized mode
              // that's `<id>__norm`. Resolve back to label + unit + raw.
              const key = String(name);
              const id = key.endsWith('__norm') ? key.slice(0, -'__norm'.length) : key;
              const m = metrics.find((mm) => mm.id === id);
              if (!m) return [String(value), key];
              const num = typeof value === 'number' ? value : Number(value);
              if (!Number.isFinite(num)) return ['—', m.label];
              if (mode === 'normalized') {
                return [`${num.toFixed(0)} (norm)`, m.label];
              }
              return [`${formatValue(num, m.unit)}${m.unit ? ` ${m.unit}` : ''}`, m.label];
            }}
          />
          <Legend
            wrapperStyle={{
              fontSize: 12,
              paddingTop: 12,
              fontFamily: 'var(--font-instrument-serif), Georgia, serif',
              fontStyle: 'italic',
              letterSpacing: '0.005em',
            }}
            iconType="plainline"
            iconSize={20}
            formatter={(value) => {
              const key = String(value);
              const id = key.endsWith('__norm') ? key.slice(0, -'__norm'.length) : key;
              const m = metrics.find((mm) => mm.id === id);
              return (
                <span style={{ color: 'var(--app-fg)', marginRight: 4 }}>
                  {m ? m.label : key}
                </span>
              );
            }}
          />
          {mode === 'multi-axis'
            ? [
                ...leftMetrics.map((m) => (
                  <Line
                    key={m.id}
                    type="monotone"
                    yAxisId="left"
                    dataKey={m.id}
                    name={m.id}
                    stroke={m.color}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    connectNulls
                  />
                )),
                ...rightMetrics.map((m) => (
                  <Line
                    key={m.id}
                    type="monotone"
                    yAxisId="right"
                    dataKey={m.id}
                    name={m.id}
                    stroke={m.color}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    connectNulls
                  />
                )),
              ]
            : metrics.map((m) => (
                <Line
                  key={m.id}
                  type="monotone"
                  dataKey={`${m.id}__norm`}
                  name={`${m.id}__norm`}
                  stroke={m.color}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                  connectNulls
                />
              ))}
        </LineChart>
      </ResponsiveContainer>
      {mode === 'multi-axis' && rightMetrics.length > 0 && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted/70">
          <span className="text-foreground">Solid:</span> L-axis ·{' '}
          {leftMetrics.map((m) => m.label).join(', ')} —{' '}
          <span className="text-foreground">dashed:</span> R-axis ·{' '}
          {rightMetrics.map((m) => m.label).join(', ')}
        </p>
      )}
    </div>
  );
}

function formatValue(v: number, unit: string): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (unit === '%' || unit === 'min' || unit === 'bpm' || unit === 'ms') return v.toFixed(0);
  if (Number.isInteger(v)) return v.toFixed(0);
  return v.toFixed(1);
}
