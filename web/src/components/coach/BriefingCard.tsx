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
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Today&rsquo;s plan
          </h2>
          {briefing?.regenerated_at && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                fresh
                  ? 'bg-accent text-white shadow-[0_0_0_4px_var(--color-accent-light)] animate-pulse'
                  : 'bg-accent-light text-accent'
              )}
            >
              {fresh ? 'just updated' : 'updated'}
            </span>
          )}
        </div>
        {briefing && (
          <button
            onClick={() => handle(true)}
            disabled={busy || loading}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
            aria-label="Regenerate briefing"
            title="Regenerate briefing"
          >
            <RefreshCw size={16} className={cn((busy || loading) && 'animate-spin')} />
          </button>
        )}
      </div>

      {!briefing ? (
        <div className="flex flex-col items-center gap-4 rounded-xl bg-gradient-to-br from-accent-light to-transparent px-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30">
            <Sparkles size={22} />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">
              No briefing for today yet
            </p>
            <p className="text-xs text-muted">
              Reads today&rsquo;s biometrics + 24h macros + last workout.
            </p>
          </div>
          <button
            onClick={() => handle(false)}
            disabled={busy || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/20 transition-all hover:opacity-90 hover:shadow-lg hover:shadow-accent/30 disabled:opacity-60"
          >
            <Sparkles size={14} />
            {busy || loading ? 'Generating…' : 'Generate today’s briefing'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Workout */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              <Dumbbell size={14} />
              <span>Workout</span>
              <Clock size={12} className="ml-auto" />
              <span className="font-mono tabular-nums">
                {briefing.workout?.duration_minutes ?? 0}m
              </span>
            </div>
            <h3 className="text-lg font-semibold leading-tight text-foreground">
              {briefing.workout?.name ?? '—'}
            </h3>
            {briefing.workout?.blocks?.length ? (
              <ol className="mt-3 space-y-1.5 text-sm">
                {briefing.workout.blocks.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-baseline gap-2 leading-relaxed text-foreground"
                  >
                    <span className="mt-0.5 text-[10px] font-mono tabular-nums text-muted">
                      {i + 1}.
                    </span>
                    <div className="flex-1">
                      <span className="font-medium">{b.name}</span>
                      {b.sets || b.reps ? (
                        <span className="ml-2 font-mono text-xs tabular-nums text-muted">
                          {b.sets ? `${b.sets}×` : ''}
                          {b.reps ?? ''}
                        </span>
                      ) : null}
                      {b.intensity ? (
                        <span className="ml-2 text-xs text-muted">@ {b.intensity}</span>
                      ) : null}
                      {b.notes ? (
                        <div className="text-xs leading-snug text-muted">{b.notes}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          {/* Meals */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              <ChefHat size={14} />
              <span>Meals</span>
            </div>
            <div className="space-y-2">
              {(briefing.meals ?? []).map((m, i) => {
                const dotClass = SLOT_DOT[m.slot?.toLowerCase()] ?? 'bg-accent';
                return (
                  <div
                    key={i}
                    className="relative overflow-hidden rounded-xl bg-card-hover p-3 pl-4"
                  >
                    <span
                      className={cn(
                        'absolute inset-y-2 left-0 w-1 rounded-full',
                        dotClass
                      )}
                      aria-hidden
                    />
                    <div className="flex items-baseline justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                          <span
                            className={cn(
                              'inline-block h-1.5 w-1.5 rounded-full',
                              dotClass
                            )}
                          />
                          {m.slot}
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-foreground">
                          {m.name}
                        </div>
                      </div>
                      <div className="text-right font-mono text-xs tabular-nums text-muted">
                        <div>{Math.round(m.macros.kcal)} kcal</div>
                        <div>
                          {Math.round(m.macros.p)}P · {Math.round(m.macros.c)}C ·{' '}
                          {Math.round(m.macros.f)}F
                        </div>
                      </div>
                    </div>
                    {m.items?.length ? (
                      <div className="mt-1.5 text-xs leading-relaxed text-muted">
                        {m.items
                          .map((i) => `${i.food} ${Math.round(i.grams)}g`)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recovery */}
          {briefing.recovery_note ? (
            <section className="rounded-xl bg-accent-light p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                <Heart size={11} /> Recovery note
              </div>
              <div className="my-2 h-px bg-accent/20" aria-hidden />
              <p className="text-sm leading-relaxed text-foreground">
                {briefing.recovery_note}
              </p>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
