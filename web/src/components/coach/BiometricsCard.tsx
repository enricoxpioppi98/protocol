'use client';

import { useState } from 'react';
import { Activity, RefreshCw, Edit3 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { BiometricsDaily } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';
import { ReadinessScore } from './ReadinessScore';

interface Props {
  biometrics: BiometricsDaily | null;
  today: string;
  onSync: () => Promise<void>;
  onEdit: () => void;
}

function isToday(dateStr: string | undefined, today: string): boolean {
  return dateStr === today;
}

export function BiometricsCard({ biometrics, today, onSync, onEdit }: Props) {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  }

  const stale = biometrics && !isToday(biometrics.date, today);

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
        </div>
      ) : allNull ? (
        <div className="py-4 text-center text-sm text-muted">
          Biometrics logged but all values are blank — sync from Garmin or edit
          manually to fill them in.
        </div>
      ) : (
        <>
          <ReadinessScore biometrics={biometrics} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sleep" value={biometrics.sleep_score} suffix="" />
            <Stat label="HRV" value={biometrics.hrv_ms} suffix="ms" />
            <Stat label="Resting HR" value={biometrics.resting_hr} suffix="bpm" />
            <Stat label="Stress" value={biometrics.stress_avg} suffix="" />
          </div>
          {lastSynced && (
            <div className="mt-3 text-[11px] text-muted/70">
              Last synced {lastSynced}
            </div>
          )}
        </>
      )}
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
