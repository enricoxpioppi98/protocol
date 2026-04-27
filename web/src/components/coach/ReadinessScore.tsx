'use client';

import { Gauge } from 'lucide-react';
import type { BiometricsDaily } from '@/lib/types/models';
import { computeReadiness, type ReadinessBand } from '@/lib/coach/readiness';
import { cn } from '@/lib/utils/cn';

interface Props {
  biometrics: BiometricsDaily | null;
}

const BAND_CLASSES: Record<
  ReadinessBand,
  { pill: string; label: string }
> = {
  green: {
    pill: 'bg-fiber-light text-fiber',
    label: 'Green',
  },
  yellow: {
    pill: 'bg-highlight-light text-highlight',
    label: 'Yellow',
  },
  red: {
    pill: 'bg-danger/10 text-danger',
    label: 'Red',
  },
  unknown: {
    pill: 'bg-card-hover text-muted',
    label: 'No data',
  },
};

export function ReadinessScore({ biometrics }: Props) {
  const { score, band, explanation } = computeReadiness(biometrics);
  const styles = BAND_CLASSES[band];
  const display = score == null ? '—' : String(score);

  return (
    <div className="mb-4 rounded-xl bg-card-hover/40 p-3">
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1">
          <Gauge size={16} className="text-muted" />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
            Readiness
          </span>
        </div>
        <div
          className={cn(
            'ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            styles.pill
          )}
        >
          {styles.label}
        </div>
      </div>

      <div className="mt-1 flex items-end gap-3">
        <div
          className={cn(
            'font-mono text-4xl font-semibold leading-none tabular-nums',
            band === 'unknown' ? 'text-muted' : 'text-foreground'
          )}
        >
          {display}
          {score != null && (
            <span className="ml-1 align-baseline text-sm font-normal text-muted">
              /100
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs leading-snug text-muted">{explanation}</p>
    </div>
  );
}
