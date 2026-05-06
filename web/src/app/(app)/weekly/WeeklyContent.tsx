'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  CalendarRange,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Compass,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

/**
 * Track 25 — weekly review UI.
 *
 * Bryan-Johnson-style: big serif date-range header, paragraph summary, two
 * columns for Wins / Concerns, projection card. Small history strip at the
 * top swaps which week is rendered. If no review exists for the current
 * week, surface a "Generate now" button that POSTs to the on-demand route.
 *
 * Falls back gracefully when biometrics are sparse — never 500s the page,
 * always shows the empty / generate state.
 */

interface WeeklyReviewSummary {
  wins: string[];
  concerns: string[];
  projection: string;
  paragraph: string;
  signals_used: string[];
}

interface WeeklyReviewRow {
  user_id: string;
  week_start: string; // YYYY-MM-DD (Monday)
  summary: WeeklyReviewSummary;
  rendered_md: string | null;
  model: string | null;
  generated_at: string;
}

const HISTORY_STRIP_LIMIT = 8;

export function WeeklyContent() {
  const supabase = useMemo(() => createClient(), []);

  const [reviews, setReviews] = useState<WeeklyReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // The Monday of the current "this week" window (Mon..Sun ending most-recent Sun).
  const currentWeekStart = useMemo(() => computeCurrentWeekStartUTC(new Date()), []);

  const fetchReviews = useCallback(async () => {
    const { data, error } = await supabase
      .from('weekly_reviews')
      .select('user_id, week_start, summary, rendered_md, model, generated_at')
      .order('week_start', { ascending: false })
      .limit(HISTORY_STRIP_LIMIT);
    if (error) {
      console.warn('[weekly] fetch failed', error);
      return [];
    }
    const rows = (data ?? []) as WeeklyReviewRow[];
    setReviews(rows);
    return rows;
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetchReviews();
        if (cancelled) return;
        // Default selection: latest review if any, else the current week (so
        // the empty / generate state renders for "this week").
        if (rows.length > 0) {
          setSelectedWeek(rows[0].week_start);
        } else {
          setSelectedWeek(currentWeekStart);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchReviews, currentWeekStart]);

  const selected = useMemo(
    () => reviews.find((r) => r.week_start === selectedWeek) ?? null,
    [reviews, selectedWeek]
  );

  async function handleGenerate(weekStart: string) {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(
        `/api/coach/weekly-review?week_start=${encodeURIComponent(weekStart)}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `request failed (${res.status})`);
      }
      const j = (await res.json()) as { review: WeeklyReviewRow };
      // Refresh history strip so the just-created row shows.
      await fetchReviews();
      setSelectedWeek(j.review.week_start);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const headerRange = selectedWeek ? formatRange(selectedWeek) : null;

  return (
    <div className="space-y-6">
      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="flex items-center gap-3">
          <div className="eyebrow text-accent">Weekly review</div>
          <div className="h-px flex-1 bg-border" />
          <button
            onClick={() => fetchReviews()}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-glass-3 hover:text-foreground"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {headerRange ? (
          <h1 className="mt-3 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[60px]">
            <span className="text-muted">{headerRange.left}</span>{' '}
            <span className="italic">—</span>{' '}
            <span>{headerRange.right}</span>
          </h1>
        ) : (
          <h1 className="mt-3 font-serif text-[44px] leading-[0.95] tracking-tight text-muted sm:text-[60px]">
            no week selected
          </h1>
        )}
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          A coach&rsquo;s read of the last seven days &mdash; what worked, what
          drifted, what to emphasize next.
        </p>
      </header>

      {/* History strip */}
      {reviews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reviews.map((r) => {
            const isActive = r.week_start === selectedWeek;
            const range = formatRange(r.week_start);
            return (
              <button
                key={r.week_start}
                onClick={() => setSelectedWeek(r.week_start)}
                className={cn(
                  'rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors',
                  isActive
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-glass-1 text-muted hover:bg-glass-3 hover:text-foreground'
                )}
                title={`${range.left} – ${range.right}`}
              >
                {range.short}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : selected ? (
        <ReviewBody review={selected} />
      ) : (
        <EmptyState
          weekStart={selectedWeek ?? currentWeekStart}
          onGenerate={handleGenerate}
          generating={generating}
          error={generateError}
        />
      )}

      {/* Inline regenerate for the selected week */}
      {selected && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => handleGenerate(selected.week_start)}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-glass-1 px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-glass-3 hover:text-foreground disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            <span>Regenerate</span>
          </button>
        </div>
      )}
      {generateError && selected && (
        <p className="text-center text-xs text-fat">{generateError}</p>
      )}
    </div>
  );
}

function ReviewBody({ review }: { review: WeeklyReviewRow }) {
  const s = review.summary;
  return (
    <div className="space-y-5">
      <section className="glass rounded-2xl border border-border px-5 py-5 sm:px-6 sm:py-6">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <CalendarRange size={12} />
          <span>Summary</span>
        </div>
        <p className="font-serif text-lg leading-snug text-foreground sm:text-xl">
          {s.paragraph}
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Column
          title="Wins"
          items={s.wins}
          dotClass="bg-emerald-500"
          icon={<CheckCircle2 size={14} className="text-emerald-500" />}
        />
        <Column
          title="Concerns"
          items={s.concerns}
          dotClass="bg-amber-500"
          icon={<AlertCircle size={14} className="text-amber-500" />}
        />
      </div>

      <section className="glass rounded-2xl border border-accent/30 px-5 py-5 sm:px-6 sm:py-6">
        <div className="eyebrow mb-3 flex items-center gap-2 text-accent">
          <Compass size={12} />
          <span>Projection · next 7 days</span>
        </div>
        <p className="font-serif text-base leading-snug text-foreground sm:text-lg">
          {s.projection}
        </p>
      </section>

      {s.signals_used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            signals_used
          </span>
          {s.signals_used.map((sig) => (
            <span
              key={sig}
              className="inline-flex items-center rounded-full border border-border bg-glass-1 px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted"
            >
              {sig}
            </span>
          ))}
        </div>
      )}

      <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
        generated {formatGenerated(review.generated_at)}
        {review.model ? ` · ${review.model}` : ''}
      </p>
    </div>
  );
}

function Column({
  title,
  items,
  dotClass,
  icon,
}: {
  title: string;
  items: string[];
  dotClass: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="glass rounded-2xl border border-border px-5 py-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="font-serif text-base text-foreground">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">&mdash;</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm leading-snug">
              <span
                className={cn(
                  'mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full',
                  dotClass
                )}
                aria-hidden
              />
              <span className="text-foreground">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState({
  weekStart,
  onGenerate,
  generating,
  error,
}: {
  weekStart: string;
  onGenerate: (weekStart: string) => Promise<void>;
  generating: boolean;
  error: string | null;
}) {
  const range = formatRange(weekStart);
  return (
    <div className="glass rounded-2xl border border-border px-6 py-12 text-center">
      <Sparkles size={28} className="mx-auto mb-3 text-muted/40" />
      <p className="font-serif text-xl text-foreground">
        No review yet for {range.short}
      </p>
      <p className="mt-2 max-w-md text-sm text-muted mx-auto">
        Reviews land Sunday evening &mdash; or generate one now from whatever
        data the week has so far.
      </p>
      <button
        onClick={() => onGenerate(weekStart)}
        disabled={generating}
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-60"
      >
        {generating ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Sparkles size={14} />
        )}
        Generate now
      </button>
      {error && <p className="mt-3 text-xs text-fat">{error}</p>}
    </div>
  );
}

// ---------- helpers ----------

function formatRange(weekStart: string): {
  left: string;
  right: string;
  short: string;
} {
  const start = parseISO(weekStart);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const left = format(start, 'MMM d').toUpperCase();
  const right = sameMonth
    ? format(end, 'd').toUpperCase()
    : format(end, 'MMM d').toUpperCase();
  const short = sameMonth
    ? `${format(start, 'MMM').toUpperCase()} ${format(start, 'd')}–${format(end, 'd')}`
    : `${format(start, 'MMM d').toUpperCase()}–${format(end, 'MMM d').toUpperCase()}`;
  return { left, right, short };
}

function formatGenerated(iso: string): string {
  try {
    return format(new Date(iso), 'MMM d, h:mma').toLowerCase();
  } catch {
    return iso;
  }
}

/**
 * Compute the Monday (UTC) of the most-recent Mon..Sun window, mirroring
 * lib/coach/weekly-review-collector.ts. Kept inline so the client bundle
 * doesn't pull the collector's Supabase / Anthropic deps.
 */
function computeCurrentWeekStartUTC(now: Date): string {
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const sunday = new Date(now);
  sunday.setUTCDate(sunday.getUTCDate() - dow);
  const monday = new Date(sunday);
  monday.setUTCDate(monday.getUTCDate() - 6);
  return monday.toISOString().slice(0, 10);
}
