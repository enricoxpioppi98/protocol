'use client';

import { useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Clock,
  ChefHat,
  Dumbbell,
  Heart,
  BookOpen,
  Check,
  Loader2,
} from 'lucide-react';
import type { BiometricsDaily, BiometricsSource, DailyBriefing } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';
import { SourceChip, freshnessSecondsFrom } from '@/components/ui/SourceChip';

type LogStatus = 'idle' | 'submitting' | 'success' | 'error';

interface Props {
  briefing: DailyBriefing | null;
  loading: boolean;
  onGenerate: (regenerate: boolean) => Promise<void>;
  /**
   * Today's merged biometrics row. Used only to render a "Signals from:"
   * source chip under the recovery note (Track 6). Optional — when omitted,
   * the chip line is hidden and the card behaves exactly as v1.
   *
   * We accept the full row (instead of just `source` + `fetched_at`) so the
   * card can later promote per-metric attribution without a prop signature
   * change. For v2 we just read primary `source` — same approach as
   * BiometricsCard, deliberately consistent.
   */
  biometrics?: BiometricsDaily | null;
  /**
   * Wave 6 — live stream of the recovery_note string while a regen is in
   * flight. When non-null, this displaces the persisted note and renders
   * with a blinking caret so the user sees the coach "typing" instead of a
   * spinner. DashboardContent owns the stream state.
   */
  streamingNote?: string | null;
}

const SLOT_DOT: Record<string, string> = {
  breakfast: 'bg-highlight',
  lunch: 'bg-accent',
  dinner: 'bg-fat',
  snack: 'bg-fiber',
};

function isFresh(regeneratedAt: string | null | undefined): boolean {
  if (!regeneratedAt) return false;
  const t = new Date(regeneratedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 60_000; // < 1 min ago = "fresh"
}

export function BriefingCard({ briefing, loading, onGenerate, biometrics, streamingNote }: Props) {
  const [busy, setBusy] = useState(false);
  const [logStatus, setLogStatus] = useState<Record<number, LogStatus>>({});

  async function handle(regenerate: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await onGenerate(regenerate);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogMeal(index: number) {
    if (!briefing) return;
    if (logStatus[index] === 'submitting') return;
    setLogStatus((s) => ({ ...s, [index]: 'submitting' }));
    try {
      const res = await fetch('/api/diary/log-briefing-meal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          briefing_date: briefing.date,
          meal_index: index,
        }),
      });
      if (!res.ok) {
        throw new Error(`request failed: ${res.status}`);
      }
      setLogStatus((s) => ({ ...s, [index]: 'success' }));
      setTimeout(() => {
        setLogStatus((s) => {
          // Only revert if still in success — don't trample a re-click.
          if (s[index] !== 'success') return s;
          const next = { ...s };
          next[index] = 'idle';
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('[BriefingCard] log meal failed', err);
      setLogStatus((s) => ({ ...s, [index]: 'error' }));
      setTimeout(() => {
        setLogStatus((s) => {
          if (s[index] !== 'error') return s;
          const next = { ...s };
          next[index] = 'idle';
          return next;
        });
      }, 3000);
    }
  }

  const fresh = isFresh(briefing?.regenerated_at);

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5 sm:p-6">
      {/* Decorative inner sheen — barely-there refraction stripe */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />

      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="eyebrow">Today&rsquo;s plan</div>
          {briefing?.regenerated_at && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors',
                fresh
                  ? 'bg-accent text-white shadow-[0_0_0_4px_var(--color-accent-light)] animate-pulse'
                  : 'bg-glass-3 text-muted'
              )}
            >
              {fresh ? '· just updated' : '· updated'}
            </span>
          )}
        </div>
        {briefing && (
          <button
            onClick={() => handle(true)}
            disabled={busy || loading}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-glass-3 hover:text-foreground disabled:opacity-50"
            aria-label="Regenerate briefing"
            title="Regenerate briefing"
          >
            <RefreshCw size={14} className={cn((busy || loading) && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* Serif card title */}
      <div className="mb-4 -mt-2 font-serif text-3xl leading-none tracking-tight text-foreground sm:text-[34px]">
        Daily <span className="italic text-muted">briefing</span>
      </div>

      {!briefing ? (
        <div className="relative flex flex-col items-center gap-4 overflow-hidden rounded-xl border border-border bg-glass-1 px-4 py-10 text-center">
          {/* Soft accent halo */}
          <span
            aria-hidden
            className="pointer-events-none absolute -top-12 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
          />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-accent">
            <Sparkles size={20} />
          </div>
          <div className="relative space-y-2">
            <p className="font-serif text-xl text-foreground">
              No briefing for today, yet.
            </p>
            <p className="text-xs text-muted">
              Reads today&rsquo;s biometrics + 24h macros + last workout.
            </p>
          </div>
          <button
            onClick={() => handle(false)}
            disabled={busy || loading}
            className="relative inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_-12px_rgb(96_165_250/0.6)] transition-all hover:bg-accent disabled:opacity-60"
          >
            <Sparkles size={14} />
            {busy || loading ? 'Generating…' : 'Generate today’s briefing'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Workout */}
          <section>
            <SectionHead
              icon={<Dumbbell size={11} />}
              label="Workout"
              right={
                briefing.workout?.duration_minutes ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted">
                    <Clock size={10} />
                    {briefing.workout.duration_minutes}
                    <span className="text-muted/60">min</span>
                  </span>
                ) : null
              }
            />
            <h3 className="mt-2 font-serif text-2xl leading-tight tracking-tight text-foreground">
              {briefing.workout?.name ?? '—'}
            </h3>
            {briefing.workout?.blocks?.length ? (
              <ol className="mt-3 space-y-2 text-sm">
                {briefing.workout.blocks.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-baseline gap-3 leading-relaxed text-foreground"
                  >
                    <span className="mt-0.5 w-5 flex-shrink-0 font-mono text-[10px] tabular-nums text-muted/60">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1">
                      <span className="font-medium">{b.name}</span>
                      {b.sets || b.reps ? (
                        <span className="ml-2 font-mono text-xs tabular-nums text-accent">
                          {b.sets ? `${b.sets}×` : ''}
                          {b.reps ?? ''}
                        </span>
                      ) : null}
                      {b.intensity ? (
                        <span className="ml-2 font-mono text-xs uppercase tracking-wider text-muted">
                          @ {b.intensity}
                        </span>
                      ) : null}
                      {b.notes ? (
                        <div className="mt-0.5 text-xs leading-snug text-muted">
                          {b.notes}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          <div className="hairline h-px" />

          {/* Meals */}
          <section>
            <SectionHead icon={<ChefHat size={11} />} label="Meals" />
            <div className="mt-3 space-y-2">
              {(briefing.meals ?? []).map((m, i) => {
                const dotClass = SLOT_DOT[m.slot?.toLowerCase()] ?? 'bg-accent';
                return (
                  <div
                    key={i}
                    className="relative overflow-hidden rounded-xl border border-border bg-glass-1 p-3 pl-4 transition-colors hover:bg-glass-2"
                  >
                    <span
                      className={cn(
                        'absolute inset-y-2 left-0 w-[2px] rounded-full',
                        dotClass
                      )}
                      aria-hidden
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                          <span
                            className={cn(
                              'inline-block h-1.5 w-1.5 rounded-full',
                              dotClass
                            )}
                          />
                          {m.slot}
                        </div>
                        <div className="mt-1 truncate font-serif text-base leading-snug text-foreground">
                          {m.name}
                        </div>
                      </div>
                      <div className="text-right font-mono text-[11px] tabular-nums text-muted">
                        <div className="text-foreground">
                          {Math.round(m.macros.kcal)}
                          <span className="ml-1 text-[9px] uppercase tracking-widest text-muted/70">
                            kcal
                          </span>
                        </div>
                        <div className="text-[10px]">
                          {Math.round(m.macros.p)}P · {Math.round(m.macros.c)}C ·{' '}
                          {Math.round(m.macros.f)}F
                        </div>
                      </div>
                    </div>
                    {m.items?.length ? (
                      <div className="mt-2 text-[11px] leading-relaxed text-muted">
                        {m.items
                          .map((i) => `${i.food} ${Math.round(i.grams)}g`)
                          .join('  ·  ')}
                      </div>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <LogMealButton
                        status={logStatus[i] ?? 'idle'}
                        disabled={!m.items?.length}
                        onClick={() => handleLogMeal(i)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recovery — streaming preview wins over the persisted note while
              a regen is in flight, so the user sees the coach "typing" rather
              than staring at the stale prior recovery_note. */}
          {streamingNote || briefing.recovery_note ? (
            <>
              <div className="hairline h-px" />
              <section className="rounded-xl border border-accent/20 bg-accent-light p-4">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  <Heart size={11} /> Recovery note
                  {streamingNote ? (
                    <span className="ml-1 inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.2em] text-accent/70">
                      · streaming
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-serif text-base leading-relaxed text-foreground">
                  &ldquo;{streamingNote ?? briefing.recovery_note}
                  {streamingNote ? (
                    <span
                      aria-hidden
                      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-accent align-baseline animate-pulse"
                    />
                  ) : null}
                  &rdquo;
                </p>
                <BriefingSignalSources biometrics={biometrics ?? null} />
              </section>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SectionHead({
  icon,
  label,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 text-muted">
      <span className="text-muted">{icon}</span>
      <span className="eyebrow">{label}</span>
      <span className="h-px flex-1 bg-border" />
      {right}
    </div>
  );
}

/**
 * "Signals from:" source attribution under the recovery note (Track 6).
 *
 * The recovery_note string emitted by the briefing prompt may include a
 * `signals_used: …` token, but it does NOT carry per-source attribution
 * (it cites *which signals* mattered, not *which device produced them*).
 * Parsing it for sources would be fragile. So per Track 6's design note we
 * surface a single chip: the priority-winner source for today's merged
 * biometrics — same source as the BiometricsCard chip, kept consistent so
 * the user reads a coherent story across the dashboard.
 *
 * Renders nothing when no biometrics row is available — graceful empty
 * state, never throws.
 */
function BriefingSignalSources({
  biometrics,
}: {
  biometrics: BiometricsDaily | null;
}) {
  if (!biometrics?.source) return null;
  const primary = biometrics.source as BiometricsSource;
  const rawList = (biometrics as unknown as { sources_present?: string | null })
    .sources_present;
  const allSources: BiometricsSource[] = (rawList
    ? rawList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [primary]) as BiometricsSource[];

  // Dedupe but preserve order; primary source first, others after.
  const ordered: BiometricsSource[] = [
    primary,
    ...allSources.filter((s) => s !== primary),
  ];
  const freshness = freshnessSecondsFrom(biometrics.fetched_at);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        Signals from
      </span>
      {ordered.map((src, i) => (
        <SourceChip
          key={src}
          source={src}
          // Only the primary chip carries the freshness tooltip — the others
          // may have stale fetched_at values we'd misattribute. Track 6
          // explicitly accepts this lossy simplification.
          freshnessSeconds={i === 0 ? freshness : undefined}
        />
      ))}
    </div>
  );
}

function LogMealButton({
  status,
  disabled,
  onClick,
}: {
  status: LogStatus;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isSubmitting = status === 'submitting';
  const isSuccess = status === 'success';
  const isError = status === 'error';

  const label = isSubmitting
    ? 'Logging…'
    : isSuccess
      ? 'Logged'
      : isError
        ? 'Retry'
        : '+ Log meal';

  const Icon = isSubmitting
    ? Loader2
    : isSuccess
      ? Check
      : BookOpen;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isSubmitting}
      aria-label={isSubmitting ? 'Logging meal to diary' : 'Log meal to diary'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isSuccess
          ? 'border-accent/50 bg-accent/15 text-accent'
          : isError
            ? 'border-fat/50 bg-fat/10 text-fat hover:bg-fat/20'
            : 'border-border bg-glass-2 text-muted hover:bg-glass-3 hover:text-foreground'
      )}
    >
      <Icon size={11} className={cn(isSubmitting && 'animate-spin')} />
      {label}
    </button>
  );
}
