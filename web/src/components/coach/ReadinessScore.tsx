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
  { pill: string; label: string; ring: string }
> = {
  green: {
    pill: 'border-fiber/30 bg-fiber-light text-fiber',
    label: 'Green',
    ring: 'ring-fiber/30',
  },
  yellow: {
    pill: 'border-highlight/30 bg-highlight-light text-highlight',
    label: 'Yellow',
    ring: 'ring-highlight/30',
  },
  red: {
    pill: 'border-danger/30 bg-danger/10 text-danger',
    label: 'Red',
    ring: 'ring-danger/30',
  },
  unknown: {
    pill: 'border-border bg-glass-2 text-muted',
    label: 'No data',
    ring: 'ring-border',
  },
};

export function ReadinessScore({ biometrics }: Props) {
  const { score, band, explanation } = computeReadiness(biometrics);
  const styles = BAND_CLASSES[band];
  const display = score == null ? '—' : String(score);

  return (
    <div className="mb-5 rounded-xl border border-border bg-glass-1 p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={12} className="text-muted" />
          <span className="eyebrow">Readiness</span>
        </div>
        <span className="h-px flex-1 bg-border" />
        <div
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]',
            styles.pill
          )}
        >
          · {styles.label}
        </div>
      </div>

      <div className="mt-3 flex items-end gap-3">
        <div
          className={cn(
            'font-mono text-[52px] font-medium leading-none tabular-nums',
            band === 'unknown' ? 'text-muted' : 'text-foreground'
          )}
        >
          {display}
          {score != null && (
            <span className="ml-1 align-baseline font-mono text-sm font-normal tracking-wider text-muted/70">
              /100
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 font-serif text-[13.5px] italic leading-snug text-muted">
        {explanation}
      </p>
    </div>
  );
}
