'use client';

import { useState } from 'react';
import { Sparkles, RefreshCw, Clock, ChefHat, Dumbbell, Heart } from 'lucide-react';
import type { DailyBriefing } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';

interface Props {
  briefing: DailyBriefing | null;
  loading: boolean;
  onGenerate: (regenerate: boolean) => Promise<void>;
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

export function BriefingCard({ briefing, loading, onGenerate }: Props) {
  const [busy, setBusy] = useState(false);

  async function handle(regenerate: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await onGenerate(regenerate);
    } finally {
      setBusy(false);
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
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recovery */}
          {briefing.recovery_note ? (
            <>
              <div className="hairline h-px" />
              <section className="rounded-xl border border-accent/20 bg-accent-light p-4">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  <Heart size={11} /> Recovery note
                </div>
                <p className="mt-2 font-serif text-base leading-relaxed text-foreground">
                  &ldquo;{briefing.recovery_note}&rdquo;
                </p>
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
