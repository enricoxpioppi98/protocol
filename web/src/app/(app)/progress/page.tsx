'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useGoals } from '@/lib/hooks/useGoals';
import { GoalSuggestionBanner } from '@/components/progress/GoalSuggestionBanner';
import { MetricPicker } from '@/components/progress/MetricPicker';
import { PresetBar } from '@/components/progress/PresetBar';
import {
  MultiMetricChart,
  type MultiMetricChartDatum,
} from '@/components/progress/MultiMetricChart';
import { MetricStatStrip } from '@/components/progress/MetricStatStrip';
import {
  METRICS_BY_ID,
  PRESETS,
  MAX_SELECTED_METRICS,
  goalForDate,
  type MetricDef,
  type Preset,
} from '@/components/progress/metricCatalog';
import { generateGoalSuggestion } from '@/lib/utils/goalSuggestion';
import { cn } from '@/lib/utils/cn';
import type {
  BiometricsDaily,
  DiaryEntry,
  WeightEntry,
} from '@/lib/types/models';

// ---- Range + persistence -----------------------------------------------
type TimeRange = '7D' | '30D' | '90D' | '1Y';
const rangeDays: Record<TimeRange, number> = { '7D': 7, '30D': 30, '90D': 90, '1Y': 365 };
const RANGES: TimeRange[] = ['7D', '30D', '90D', '1Y'];

const STORAGE_KEY = 'protocol:progress:v1';

interface PersistedState {
  metricIds: string[];
  range: TimeRange;
}

function readPersisted(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const range: TimeRange = (RANGES as string[]).includes(parsed.range as string)
      ? (parsed.range as TimeRange)
      : '30D';
    const metricIds = Array.isArray(parsed.metricIds)
      ? (parsed.metricIds as string[]).filter((id) => METRICS_BY_ID[id]).slice(0, MAX_SELECTED_METRICS)
      : [];
    return { metricIds, range };
  } catch {
    return null;
  }
}

function defaultPreset(): PersistedState {
  const recovery = PRESETS.find((p) => p.id === 'recovery') ?? PRESETS[0];
  return { metricIds: recovery.metricIds, range: '30D' };
}

// ---- Page --------------------------------------------------------------
export default function ProgressPage() {
  // Hydrate from localStorage on mount; until then we render the Recovery
  // preset so the chart never flashes empty for first-time users.
  const [hydrated, setHydrated] = useState(false);
  const [range, setRange] = useState<TimeRange>('30D');
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>(
    defaultPreset().metricIds
  );

  useEffect(() => {
    const persisted = readPersisted();
    const initial = persisted ?? defaultPreset();
    setRange(initial.range);
    setSelectedMetricIds(initial.metricIds);
    setHydrated(true);
  }, []);

  // Persist on change (after hydration so we don't clobber on first render).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ metricIds: selectedMetricIds, range } satisfies PersistedState)
      );
    } catch {
      /* localStorage may be unavailable (private mode etc.) — silent no-op */
    }
  }, [hydrated, selectedMetricIds, range]);

  // ---- Data ------------------------------------------------------------
  const supabase = useMemo(() => createClient(), []);
  const { goals, getGoalForDate } = useGoals();
  const todayGoal = getGoalForDate(new Date());

  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
  const [biometrics, setBiometrics] = useState<BiometricsDaily[]>([]);
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  const days = rangeDays[range];

  // Always fetch the LARGEST range we'd want (1Y) so range-flipping doesn't
  // re-trigger network calls. Charts/stats slice client-side.
  const FETCH_DAYS = 365;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - FETCH_DAYS);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const [diaryRes, bioRes, weightRes] = await Promise.all([
      supabase
        .from('diary_entries')
        .select(
          '*, food:foods(*), recipe:recipes(*, ingredients:recipe_ingredients(*, food:foods(*)))'
        )
        .gte('date', cutoffStr)
        .is('deleted_at', null),
      supabase
        .from('biometrics_daily')
        .select('*')
        .gte('date', cutoffStr)
        .order('date', { ascending: true }),
      supabase
        .from('weight_entries')
        .select('*')
        .gte('date', cutoffStr)
        .is('deleted_at', null)
        .order('date', { ascending: true }),
    ]);

    if (diaryRes.data) setDiaryEntries(diaryRes.data as DiaryEntry[]);
    if (bioRes.data) setBiometrics(bioRes.data as BiometricsDaily[]);
    if (weightRes.data) setWeightEntries(weightRes.data as WeightEntry[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Goal-suggestion banner state — preserved from the previous page.
  useEffect(() => {
    const dismissed = window.localStorage.getItem('suggestion_dismissed');
    if (dismissed) {
      const t = parseInt(dismissed, 10);
      if (Date.now() - t < 7 * 24 * 3600 * 1000) {
        setSuggestionDismissed(true);
      }
    }
  }, []);
  function handleDismissSuggestion() {
    window.localStorage.setItem('suggestion_dismissed', Date.now().toString());
    setSuggestionDismissed(true);
  }

  // ---- Build the unified daily series for the visible range ----------
  const chartData: MultiMetricChartDatum[] = useMemo(() => {
    const dates: string[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    const diaryByDate = new Map<string, DiaryEntry[]>();
    for (const e of diaryEntries) {
      const list = diaryByDate.get(e.date) ?? [];
      list.push(e);
      diaryByDate.set(e.date, list);
    }
    const bioByDate = new Map<string, BiometricsDaily>();
    for (const b of biometrics) bioByDate.set(b.date, b);
    const weightByDate = new Map<string, WeightEntry>();
    for (const w of weightEntries) weightByDate.set(w.date, w);

    const selectedMetrics = selectedMetricIds
      .map((id) => METRICS_BY_ID[id])
      .filter((m): m is MetricDef => Boolean(m));

    return dates.map((date) => {
      const ctx = {
        diaryEntries: diaryByDate.get(date) ?? [],
        goal: goalForDate(goals, new Date(date)),
        biometrics: bioByDate.get(date) ?? null,
        weight: weightByDate.get(date) ?? null,
      };
      const row: MultiMetricChartDatum = { date };
      for (const m of selectedMetrics) {
        row[m.id] = m.getter(ctx);
      }
      return row;
    });
  }, [days, diaryEntries, biometrics, weightEntries, goals, selectedMetricIds]);

  const selectedMetrics = useMemo(
    () =>
      selectedMetricIds
        .map((id) => METRICS_BY_ID[id])
        .filter((m): m is MetricDef => Boolean(m)),
    [selectedMetricIds]
  );

  // Y-axis strategy: multi-axis up to the picker cap. Normalized is wired
  // up but not exposed in the UI (the cap of 6 keeps multi-axis legible).
  const chartMode: 'multi-axis' | 'normalized' =
    selectedMetrics.length > MAX_SELECTED_METRICS ? 'normalized' : 'multi-axis';

  // Goal-suggestion still uses the macro-tracker math.
  const suggestion = !suggestionDismissed
    ? generateGoalSuggestion([], diaryEntries, todayGoal)
    : null;

  function applyPreset(p: Preset) {
    setSelectedMetricIds(p.metricIds.slice(0, MAX_SELECTED_METRICS));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Progress</h1>
        <div className="flex gap-1 rounded-xl bg-card p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'min-w-[44px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                range === r ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {suggestion && (
        <GoalSuggestionBanner suggestion={suggestion} onDismiss={handleDismissSuggestion} />
      )}

      <PresetBar selected={selectedMetricIds} onApply={applyPreset} />

      {loading ? (
        <div
          className="flex items-center justify-center rounded-2xl bg-card text-sm text-muted"
          style={{ height: 360 }}
        >
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <MultiMetricChart data={chartData} metrics={selectedMetrics} mode={chartMode} />
      )}

      <MetricStatStrip metrics={selectedMetrics} data={chartData} />

      <MetricPicker selected={selectedMetricIds} onChange={setSelectedMetricIds} />
    </div>
  );
}
