'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  RefreshCw,
  Edit3,
  History,
  Settings2,
  Star,
  StarOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { BiometricsDaily } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';
import { ReadinessScore } from './ReadinessScore';
import { BiometricsTrend } from './BiometricsTrend';

interface Props {
  biometrics: BiometricsDaily | null;
  today: string;
  onSync: () => Promise<void>;
  onEdit: () => void;
  /** All biometric rows we have for this user (today + history). Used by the trend strip. */
  history?: BiometricsDaily[];
  /** Optional: sync past N days from Garmin. */
  onBackfill?: (days: number) => Promise<void>;
  /**
   * Pinned metric identifiers from `user_profile.pinned_metrics`. When
   * omitted, the card falls back to the canonical 4-metric grid so callers
   * that haven't wired up the picker yet keep today's behavior.
   */
  pinned?: string[];
  /**
   * Persist a new pin order. Wired to the PUT `/api/profile/pinned-metrics`
   * endpoint via `useUserProfile().setPinned`.
   */
  onChangePinned?: (next: string[]) => Promise<void>;
}

const MAX_PINNED = 8;

const DEFAULT_PINNED: readonly string[] = [
  'sleep_score',
  'hrv_ms',
  'resting_hr',
  'stress_avg',
];

interface MetricDef {
  id: string;
  label: string;
  unit: string;
  /**
   * Permissive getter: most fields live on `BiometricsDaily` today, but
   * Track H is extending the row with new fields (total_steps, vo2max,
   * deep_sleep_minutes, etc.) on a separate branch. Those fields don't
   * exist on the current TS type, so the catalog reads them through
   * `as any` and falls back to `null`. Once Track H ships, the `as any`
   * casts can be tightened — until then this stays runtime-safe and
   * type-clean.
   */
  getter: (b: BiometricsDaily) => number | null | undefined;
}

const AVAILABLE_METRICS: MetricDef[] = [
  { id: 'sleep_score', label: 'Sleep score', unit: '', getter: (b) => b.sleep_score },
  {
    id: 'sleep_duration_minutes',
    label: 'Sleep duration',
    unit: 'min',
    getter: (b) => b.sleep_duration_minutes,
  },
  { id: 'hrv_ms', label: 'HRV', unit: 'ms', getter: (b) => b.hrv_ms },
  { id: 'resting_hr', label: 'Resting HR', unit: 'bpm', getter: (b) => b.resting_hr },
  { id: 'stress_avg', label: 'Stress', unit: '', getter: (b) => b.stress_avg },
  // Track H extension fields — not on BiometricsDaily yet, hence the `as any`.
  {
    id: 'total_steps',
    label: 'Steps',
    unit: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).total_steps ?? null,
  },
  {
    id: 'active_minutes',
    label: 'Active minutes',
    unit: 'min',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).active_minutes ?? null,
  },
  {
    id: 'vigorous_minutes',
    label: 'Vigorous minutes',
    unit: 'min',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).vigorous_minutes ?? null,
  },
  {
    id: 'vo2max',
    label: 'VO2 max',
    unit: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).vo2max ?? null,
  },
  {
    id: 'deep_sleep_minutes',
    label: 'Deep sleep',
    unit: 'min',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).deep_sleep_minutes ?? null,
  },
  {
    id: 'rem_sleep_minutes',
    label: 'REM sleep',
    unit: 'min',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).rem_sleep_minutes ?? null,
  },
  {
    id: 'sleep_efficiency',
    label: 'Sleep efficiency',
    unit: '%',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).sleep_efficiency ?? null,
  },
  {
    id: 'body_battery_high',
    label: 'Body battery high',
    unit: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).body_battery_high ?? null,
  },
  {
    id: 'total_kcal_burned',
    label: 'Calories burned',
    unit: 'kcal',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).total_kcal_burned ?? null,
  },
  {
    id: 'floors_climbed',
    label: 'Floors',
    unit: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter: (b) => (b as any).floors_climbed ?? null,
  },
];

const METRIC_BY_ID: Record<string, MetricDef> = AVAILABLE_METRICS.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<string, MetricDef>
);

function isToday(dateStr: string | undefined, today: string): boolean {
  return dateStr === today;
}

export function BiometricsCard({
  biometrics,
  today,
  onSync,
  onEdit,
  history,
  onBackfill,
  pinned,
  onChangePinned,
}: Props) {
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Resolve the effective pin list. Filter against the catalog so unknown ids
  // (e.g. legacy / typos) silently drop instead of blowing up the render.
  const effectivePinned: string[] = useMemo(() => {
    const source =
      pinned && pinned.length > 0 ? pinned : (DEFAULT_PINNED as string[]);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of source) {
      if (!METRIC_BY_ID[id]) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [pinned]);

  const pinnedSet = useMemo(() => new Set(effectivePinned), [effectivePinned]);
  const atCap = effectivePinned.length >= MAX_PINNED;

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackfill() {
    if (backfilling || !onBackfill) return;
    setBackfilling(true);
    try {
      await onBackfill(7);
    } finally {
      setBackfilling(false);
    }
  }

  async function togglePin(id: string) {
    if (!onChangePinned) return;
    if (pinnedSet.has(id)) {
      await onChangePinned(effectivePinned.filter((p) => p !== id));
    } else {
      if (atCap) return; // soft cap; star is disabled in the UI too
      await onChangePinned([...effectivePinned, id]);
    }
  }

  const stale = biometrics && !isToday(biometrics.date, today);

  // "All null" check is unchanged — the canonical 4 metrics define whether
  // Garmin has computed today's wellness data, regardless of what's pinned.
  const allNull =
    biometrics &&
    biometrics.sleep_score == null &&
    biometrics.hrv_ms == null &&
    biometrics.resting_hr == null &&
    biometrics.stress_avg == null;

  let lastSynced: string | null = null;
  if (biometrics?.fetched_at) {
    try {
      lastSynced = formatDistanceToNow(new Date(biometrics.fetched_at), {
        addSuffix: true,
      });
    } catch {
      lastSynced = null;
    }
  }

  const canPin = Boolean(onChangePinned);

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Biometrics
          </h2>
          {biometrics?.source === 'manual' && (
            <span className="rounded-full bg-card-hover px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              manual
            </span>
          )}
          {stale && (
            <span className="rounded-full bg-highlight-light px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-highlight">
              from {biometrics.date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canPin ? (
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className={cn(
                'rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground',
                pickerOpen && 'bg-card-hover text-foreground'
              )}
              aria-label="Pin metrics"
              aria-expanded={pickerOpen}
            >
              <Settings2 size={16} />
            </button>
          ) : null}
          <button
            onClick={onEdit}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
            aria-label="Edit biometrics manually"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
            aria-label="Sync from Garmin"
          >
            <RefreshCw size={16} className={cn(syncing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {!biometrics ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <p className="text-sm text-muted">No data yet today.</p>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw size={14} className={cn(syncing && 'animate-spin')} />
              Sync from Garmin
            </button>
            <button
              onClick={onEdit}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-card-hover px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover/80"
            >
              <Edit3 size={14} />
              Enter manually
            </button>
          </div>
          {onBackfill ? (
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
            >
              <History size={12} className={cn(backfilling && 'animate-spin')} />
              {backfilling ? 'Backfilling…' : 'Pull last 7 days from Garmin'}
            </button>
          ) : null}
        </div>
      ) : allNull ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-sm text-muted">
            Garmin hasn&rsquo;t computed today&rsquo;s wellness data yet — usually
            populates a few hours after your watch syncs the morning. Pull
            historical days to fill the trend in the meantime.
          </p>
          {onBackfill ? (
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <History size={14} className={cn(backfilling && 'animate-spin')} />
              {backfilling ? 'Backfilling…' : 'Pull last 7 days'}
            </button>
          ) : null}
          {history && history.length > 1 ? (
            <BiometricsTrend rows={history} days={7} />
          ) : null}
        </div>
      ) : (
        <>
          <ReadinessScore biometrics={biometrics} />
          <MetricsGrid metrics={effectivePinned} biometrics={biometrics} />
          {pickerOpen && canPin ? (
            <MetricsPicker
              biometrics={biometrics}
              pinnedSet={pinnedSet}
              atCap={atCap}
              onToggle={togglePin}
            />
          ) : null}
          {history && history.length > 0 ? (
            <BiometricsTrend rows={history} days={7} />
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {lastSynced ? (
              <div className="text-[11px] text-muted/70">Last synced {lastSynced}</div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              {canPin ? (
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    pickerOpen
                      ? 'bg-accent text-white hover:bg-accent/90'
                      : 'border border-border text-foreground hover:bg-card-hover'
                  )}
                  title="Choose which metrics show on the dashboard"
                >
                  <Settings2 size={12} />
                  {pickerOpen ? 'Done' : 'Customize metrics'}
                </button>
              ) : null}
              {onBackfill ? (
                <button
                  onClick={handleBackfill}
                  disabled={backfilling}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
                  title="Pull the last 7 days from Garmin"
                >
                  <History size={12} className={cn(backfilling && 'animate-spin')} />
                  {backfilling ? 'Backfilling…' : 'Pull 7 days'}
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricsGrid({
  metrics,
  biometrics,
}: {
  metrics: string[];
  biometrics: BiometricsDaily;
}) {
  if (metrics.length === 0) {
    return (
      <div className="rounded-xl bg-card-hover px-4 py-3 text-center text-xs text-muted">
        No metrics pinned. Use the pin menu to choose which to show.
      </div>
    );
  }
  // 2 cols on mobile, 3 cols at sm, 4 at md+. Caps cleanly at the 8 max.
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {metrics.map((id) => {
        const def = METRIC_BY_ID[id];
        if (!def) return null;
        const value = def.getter(biometrics) ?? null;
        return (
          <Stat
            key={id}
            label={def.label}
            value={value}
            suffix={def.unit}
          />
        );
      })}
    </div>
  );
}

function MetricsPicker({
  biometrics,
  pinnedSet,
  atCap,
  onToggle,
}: {
  biometrics: BiometricsDaily;
  pinnedSet: Set<string>;
  atCap: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-card-hover/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Pin metrics
        </div>
        <div className="text-[11px] text-muted/70">
          {pinnedSet.size}/{MAX_PINNED} pinned
        </div>
      </div>
      <ul className="divide-y divide-border/50">
        {AVAILABLE_METRICS.map((m) => {
          const isPinned = pinnedSet.has(m.id);
          const value = m.getter(biometrics) ?? null;
          const disabled = !isPinned && atCap;
          return (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{m.label}</div>
                <div className="font-mono text-[11px] tabular-nums text-muted">
                  {value ?? '—'}
                  {value != null && m.unit ? (
                    <span className="ml-1">{m.unit}</span>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => onToggle(m.id)}
                disabled={disabled}
                title={
                  disabled
                    ? `Max ${MAX_PINNED} pinned`
                    : isPinned
                      ? 'Unpin'
                      : 'Pin'
                }
                aria-label={
                  isPinned ? `Unpin ${m.label}` : `Pin ${m.label}`
                }
                className={cn(
                  'rounded-lg p-2 transition-colors',
                  isPinned
                    ? 'text-accent hover:bg-card-hover'
                    : 'text-muted hover:bg-card-hover hover:text-foreground',
                  disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent'
                )}
              >
                {isPinned ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null | undefined;
  suffix: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value ?? '—'}
        {value != null && suffix ? (
          <span className="ml-1 text-xs font-normal text-muted">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}
