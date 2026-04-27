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

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Today&rsquo;s plan
          </h2>
          {briefing?.regenerated_at && (
            <span className="rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              updated
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
        <div className="space-y-3 py-4">
          <p className="text-sm text-muted">
            No briefing for today yet. Generate one based on your latest biometrics
            and macro log.
          </p>
          <button
            onClick={() => handle(false)}
            disabled={busy || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Sparkles size={14} />
            {busy || loading ? 'Generating…' : 'Generate today’s briefing'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Workout */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <Dumbbell size={14} />
              <span>Workout</span>
              <Clock size={12} className="ml-auto" />
              <span className="font-mono tabular-nums">
                {briefing.workout?.duration_minutes ?? 0}m
              </span>
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {briefing.workout?.name ?? '—'}
            </h3>
            {briefing.workout?.blocks?.length ? (
              <ol className="mt-2 space-y-1.5 text-sm">
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
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <ChefHat size={14} />
              <span>Meals</span>
            </div>
            <div className="space-y-2.5">
              {(briefing.meals ?? []).map((m, i) => (
                <div key={i} className="rounded-xl bg-card-hover p-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                        {m.slot}
                      </div>
                      <div className="text-sm font-semibold text-foreground">
                        {m.name}
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums text-muted">
                      <div>
                        {Math.round(m.macros.kcal)} kcal
                      </div>
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
              ))}
            </div>
          </section>

          {/* Recovery */}
          {briefing.recovery_note ? (
            <section className="rounded-xl bg-accent-light p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
                <Heart size={12} /> Recovery note
              </div>
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
