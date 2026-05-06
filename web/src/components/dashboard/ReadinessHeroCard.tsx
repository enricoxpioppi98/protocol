'use client';

import { Activity } from 'lucide-react';
import type { BiometricsDaily } from '@/lib/types/models';
import {
  computePersonalizedReadiness,
  type ReadinessBand,
  type ReadinessSubscores,
} from '@/lib/coach/readiness';
import { cn } from '@/lib/utils/cn';

/**
 * Wave 5 phase 2 — the dashboard's hero numeral.
 *
 * Replaces the misleading "Data Health 100/100" card. This is the score the
 * user actually expected to see when they checked in after a bad night's
 * sleep. Synthesizes today's biometrics against the user's own 30-day
 * baseline (HRV + RHR) plus absolute Garmin sleep score and stress.
 *
 * Renders a Bryan-Johnson-style serif numeral, the band pill, a one-line
 * explanation, and a 4-bar subscore breakdown (sleep / HRV / RHR / stress)
 * so the user understands the *why* without leaving the dashboard.
 */

interface Props {
  /** Today's biometric row, from the merged view. May be null on cold start. */
  biometrics: BiometricsDaily | null;
  /**
   * Trailing biometrics history for the baseline (newest-first or
   * oldest-first both work). The component slices to days strictly before
   * `todayStr` for the baseline math.
   */
  history: BiometricsDaily[];
  /** ISO YYYY-MM-DD anchor for the baseline. */
  todayStr: string;
}

const BAND_NUMERAL_CLASS: Record<ReadinessBand, string> = {
  green: 'text-fiber',
  yellow: 'text-highlight',
  red: 'text-danger',
  unknown: 'text-muted',
};

const BAND_LABEL: Record<ReadinessBand, string> = {
  green: 'ready',
  yellow: 'mixed',
  red: 'recover',
  unknown: 'no data',
};

const BAND_PILL_CLASS: Record<ReadinessBand, string> = {
  green: 'border-fiber/30 bg-fiber-light text-fiber',
  yellow: 'border-highlight/30 bg-highlight-light text-highlight',
  red: 'border-danger/30 bg-danger/10 text-danger',
  unknown: 'border-border bg-glass-2 text-muted',
};

const SUB_LABEL = {
  sleep: 'Sleep',
  hrv: 'HRV',
  rhr: 'Resting HR',
  stress: 'Stress',
} as const;

function subscoreBarColor(value: number | null): string {
  if (value == null) return 'bg-muted/20';
  if (value >= 75) return 'bg-fiber';
  if (value >= 50) return 'bg-highlight';
  return 'bg-danger';
}

interface SubscoreRowProps {
  label: string;
  value: number | null;
  /** Optional caption shown to the right (e.g. "vs your 30d 58ms"). */
  caption?: string | null;
}

function SubscoreRow({ label, value, caption }: SubscoreRowProps) {
  const display = value == null ? '—' : Math.round(value).toString();
  const fill = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-[68px] shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/70">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-glass-2">
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-all',
            subscoreBarColor(value)
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right font-mono tabular-nums text-foreground">
        {display}
      </span>
      {caption ? (
        <span className="hidden truncate font-mono text-[10px] tabular-nums text-muted/60 sm:inline">
          {caption}
        </span>
      ) : null}
    </div>
  );
}

export function ReadinessHeroCard({ biometrics, history, todayStr }: Props) {
  const result = computePersonalizedReadiness({
    today: biometrics,
    history,
    todayDate: todayStr,
  });

  const { score, band, explanation, subscores, personalized, personal_baseline } =
    result;

  const display = score == null ? '—' : String(score);
  const numeralClass = BAND_NUMERAL_CLASS[band];
  const baselineHrv = personal_baseline.hrv_ms;
  const baselineRhr = personal_baseline.resting_hr;

  const subRows: Array<{
    label: string;
    value: number | null;
    caption: string | null;
  }> = [
    {
      label: SUB_LABEL.sleep,
      value: subscores.sleep,
      caption: biometrics?.sleep_score != null ? `${biometrics.sleep_score} score` : null,
    },
    {
      label: SUB_LABEL.hrv,
      value: subscores.hrv,
      caption:
        biometrics?.hrv_ms != null
          ? baselineHrv != null
            ? `${biometrics.hrv_ms}ms · 30d med ${Math.round(baselineHrv)}`
            : `${biometrics.hrv_ms}ms`
          : null,
    },
    {
      label: SUB_LABEL.rhr,
      value: subscores.rhr,
      caption:
        biometrics?.resting_hr != null
          ? baselineRhr != null
            ? `${biometrics.resting_hr}bpm · 30d med ${Math.round(baselineRhr)}`
            : `${biometrics.resting_hr}bpm`
          : null,
    },
    {
      label: SUB_LABEL.stress,
      value: subscores.stress,
      caption: biometrics?.stress_avg != null ? `${biometrics.stress_avg}` : null,
    },
  ];

  return (
    <div
      className="glass-strong block rounded-2xl p-5"
      aria-label={`Readiness ${display} of 100, ${BAND_LABEL[band]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-muted" />
            <span className="eyebrow">Readiness</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]',
                BAND_PILL_CLASS[band]
              )}
            >
              · {BAND_LABEL[band]}
            </span>
            {personalized ? (
              <span
                className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted/60"
                title="HRV and RHR scored against your own 30-day baseline."
              >
                · personalized
              </span>
            ) : (
              <span
                className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted/40"
                title="Using population-norm subscores until you have ≥7 days of HRV/RHR history."
              >
                · pop. baseline
              </span>
            )}
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={cn(
                'font-serif text-[64px] leading-none tabular-nums',
                numeralClass
              )}
            >
              {display}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted/70">
              / 100
            </span>
          </div>

          <p className="mt-3 max-w-md font-serif text-sm italic leading-snug text-muted">
            {explanation}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-border pt-4">
        {subRows.map((r) => (
          <SubscoreRow key={r.label} label={r.label} value={r.value} caption={r.caption} />
        ))}
      </div>
    </div>
  );
}
