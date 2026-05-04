'use client';

import type { BiometricsDaily, BiometricsSource } from '@/lib/types/models';
import { SourceChip, freshnessSecondsFrom } from '@/components/ui/SourceChip';
import {
  computeRollingBaseline,
  formatDelta,
  type BaselineWindow,
  type DeltaSummary,
  type RollingBaseline,
  SIGMA_WARN,
  SIGMA_ALERT,
} from '@/lib/coach/baselines';
import { cn } from '@/lib/utils/cn';
import type { MetricDef } from './metricCatalog';
import type { MultiMetricChartDatum } from './MultiMetricChart';

interface Props {
  metrics: MetricDef[];
  data: MultiMetricChartDatum[];
  /**
   * Optional biometrics rows from `biometrics_daily_merged`. Used for two
   * purposes now:
   *  1. The SourceChip next to biometrics-sourced metrics (Track 6 attribution).
   *  2. The Track-9 self-baseline math: rolling median/mean/σ over the chosen
   *     window (excluding today), and a "today vs baseline" delta chip.
   *
   * For non-biometrics metrics (diary-aggregated nutrition, weight) we fall
   * back to baselining against the chart `data` array — the only source of
   * those values we have here.
   */
  biometrics?: BiometricsDaily[];
  /**
   * The trailing window the parent has selected (7/30/90/365). Defaults to 30
   * to match the page-level default. Affects both the baseline math and the
   * chip caption.
   */
  baselineWindow?: BaselineWindow;
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

/**
 * Build a synthetic BiometricsDaily-shaped array out of the chart's daily
 * data so the baseline math works uniformly across diary/weight metrics. We
 * key the value off `metric.id` (the dataKey the chart uses); the baseline
 * function just reads `row[metric.id]` so it doesn't care that this isn't a
 * "real" BiometricsDaily.
 */
function chartRowsAsBiometrics(
  data: MultiMetricChartDatum[],
  metricId: string,
): BiometricsDaily[] {
  // We only need `date` and `[metricId]`. The baseline reader ignores all
  // other fields, so casting through unknown is safe and avoids inventing
  // null fillers for every BiometricsDaily column.
  return data
    .filter((d) => typeof d[metricId] === 'number' && Number.isFinite(d[metricId] as number))
    .map((d) => ({ date: d.date, [metricId]: d[metricId] }) as unknown as BiometricsDaily);
}

export function MetricStatStrip({ metrics, data, biometrics, baselineWindow = 30 }: Props) {
  if (metrics.length === 0) return null;

  // Latest biometrics row — used to read the priority-winner `source` for
  // any biometrics-sourced metric in the strip. The merged view is sorted
  // ascending by date in progress/page.tsx, so the latest row is the tail.
  // Defensive: pick the row with the largest date string (lex sort works on
  // ISO YYYY-MM-DD) so we don't depend on caller ordering.
  const latestBio: BiometricsDaily | null =
    biometrics && biometrics.length > 0
      ? biometrics.reduce(
          (acc, row) => (acc == null || row.date > acc.date ? row : acc),
          null as BiometricsDaily | null
        )
      : null;
  const latestSource = latestBio?.source as BiometricsSource | undefined;
  const latestFreshness = freshnessSecondsFrom(latestBio?.fetched_at);

  // Anchor "today" off whatever the most recent date is in the data we
  // actually have. Beats `new Date()` because the user may not have synced
  // today yet — using the latest seen date keeps the baseline meaningful.
  // Falls back to ISO today if both arrays are empty (no chips render anyway).
  const todayIso = (() => {
    let max = '';
    if (biometrics) for (const r of biometrics) if (r.date > max) max = r.date;
    for (const r of data) if (r.date > max) max = r.date;
    return max || new Date().toISOString().split('T')[0];
  })();

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((m) => {
        const s = summarize(m, data);
        // Only biometrics-sourced metrics carry a chip — diary/weight come
        // from the user's logging, not from a wearable integration.
        const showChip = m.source === 'biometrics' && latestSource;

        // Source rows the baseline reads: real BiometricsDaily for biometrics
        // metrics (column lookup by name), synthetic rows for diary/weight.
        const baselineRows: BiometricsDaily[] =
          m.source === 'biometrics' && biometrics
            ? biometrics
            : chartRowsAsBiometrics(data, m.id);
        // The baseline lib indexes by `keyof BiometricsDaily`. For diary
        // metrics the dataKey is the metric id (e.g. `protein_consumed`) —
        // type-unsafe at compile-time but safe at runtime since chart rows
        // only carry that key. Cast explicitly so consumers can read this
        // module without surprises.
        const baselineKey = m.id as keyof BiometricsDaily;
        const baseline = computeRollingBaseline(
          baselineRows,
          baselineKey,
          baselineWindow,
          todayIso,
        );
        // Today's value comes out of the chart row matching `todayIso` so we
        // baseline against the same data the chart shows.
        const todayRow = data.find((d) => d.date === todayIso);
        const todayVal =
          todayRow && typeof todayRow[m.id] === 'number' && Number.isFinite(todayRow[m.id] as number)
            ? (todayRow[m.id] as number)
            : null;
        const delta =
          baseline && todayVal != null ? formatDelta(todayVal, baseline) : null;

        return (
          <div key={m.id} className="rounded-2xl bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: m.color }}
                />
                <span className="text-xs font-medium text-foreground">{m.label}</span>
                {showChip ? (
                  <SourceChip
                    source={latestSource}
                    freshnessSeconds={latestFreshness}
                  />
                ) : null}
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
            <BaselineChip
              window={baselineWindow}
              baseline={baseline}
              today={todayVal}
              delta={delta}
              unit={m.unit}
            />
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

/**
 * Single-line "today vs your baseline" caption. Renders three regions:
 *
 *   <window>d median  ·  ±σ  ·  today (signed σ)
 *
 * We color the σ pill based on |z|: yellow above SIGMA_WARN (1), red above
 * SIGMA_ALERT (2). When there's no baseline (insufficient history) we render
 * a quiet "building baseline…" line so users know the feature exists.
 */
function BaselineChip({
  window,
  baseline,
  today,
  delta,
  unit,
}: {
  window: BaselineWindow;
  baseline: RollingBaseline | null;
  today: number | null;
  delta: DeltaSummary | null;
  unit: string;
}) {
  if (!baseline) {
    return (
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted/70">
        building {window}d baseline…
      </div>
    );
  }

  const sigmaLabel =
    delta == null
      ? null
      : `${delta.sigma >= 0 ? '+' : '−'}${Math.abs(delta.sigma).toFixed(1)}σ`;

  const absSigma = delta ? Math.abs(delta.sigma) : 0;
  const sigmaTone =
    delta == null
      ? 'text-muted'
      : absSigma > SIGMA_ALERT
      ? 'text-danger'
      : absSigma > SIGMA_WARN
      ? 'text-highlight'
      : 'text-fiber';

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
      <span>
        {window}d med <span className="text-foreground tabular-nums">{fmt(baseline.median, unit)}</span>
        {unit ? <span className="ml-0.5 lowercase text-muted/80">{unit}</span> : null}
      </span>
      <span className="text-muted/40">·</span>
      <span>
        ±σ <span className="text-foreground tabular-nums">{fmt(baseline.stdDev, unit)}</span>
      </span>
      <span className="text-muted/40">·</span>
      {today != null ? (
        <>
          <span>
            today <span className="text-foreground tabular-nums">{fmt(today, unit)}</span>
          </span>
          {sigmaLabel ? (
            <span
              className={cn(
                'rounded-full bg-glass-2 px-1.5 py-0.5 font-mono tabular-nums',
                sigmaTone,
              )}
              title={delta ? `${delta.label} your ${window}-day baseline` : undefined}
            >
              {sigmaLabel}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted/70">no value today</span>
      )}
    </div>
  );
}
