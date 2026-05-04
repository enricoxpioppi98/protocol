'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO, formatDistanceToNowStrict, differenceInCalendarDays } from 'date-fns';
import {
  CalendarDays,
  ChefHat,
  ChevronDown,
  Dumbbell,
  Flame,
  Heart,
  Moon,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { BiometricsDaily, DailyBriefing } from '@/lib/types/models';
import { BriefingCard } from '@/components/coach/BriefingCard';
import { cn } from '@/lib/utils/cn';

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [briefings, setBriefings] = useState<DailyBriefing[]>([]);
  const [biometricsByDate, setBiometricsByDate] = useState<Record<string, BiometricsDaily>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Today's local date — used to skip the active dashboard day from the timeline.
  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const fetchBiometricsFor = useCallback(
    async (dates: string[]) => {
      if (dates.length === 0) return;
      // Merged view (migration 013) — one row per (user_id, date) regardless
      // of how many sources synced that day, so the timeline cards never show
      // mismatched HRV from different watches on the same row.
      const { data } = await supabase
        .from('biometrics_daily_merged')
        .select('*')
        .in('date', dates);
      if (!data) return;
      setBiometricsByDate((prev) => {
        const next = { ...prev };
        for (const row of data as BiometricsDaily[]) {
          next[row.date] = row;
        }
        return next;
      });
    },
    [supabase]
  );

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      const { data, error } = await supabase
        .from('daily_briefing')
        .select('*')
        .lt('date', todayStr)
        .order('date', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.warn('history fetch failed', error);
        return;
      }
      const rows = (data ?? []) as DailyBriefing[];
      setBriefings((prev) => (replace ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      // Pull biometrics for the newly loaded dates in one round-trip.
      await fetchBiometricsFor(rows.map((r) => r.date));
    },
    [supabase, todayStr, fetchBiometricsFor]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchPage(0, true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchPage(0, true);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(briefings.length, false);
    } finally {
      setLoadingMore(false);
    }
  }

  const streak = useMemo(() => computeStreak(briefings, todayStr), [briefings, todayStr]);

  return (
    <div className="space-y-5">
      <header className="mb-2 animate-[fadeIn_0.4s_ease-out]">
        <div className="flex items-center gap-3">
          <div className="eyebrow text-accent">Archive</div>
          <div className="h-px flex-1 bg-border" />
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-glass-3 hover:text-foreground disabled:opacity-50"
            aria-label="Refresh history"
            title="Refresh history"
          >
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
          </button>
        </div>
        <h1 className="mt-3 font-serif text-[52px] leading-[0.95] tracking-tight text-foreground sm:text-[64px]">
          Past <span className="italic text-muted">plans</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Every day Protocol coached you. Tap a day to see the full briefing.
        </p>
      </header>

      {streak > 0 && (
        <div className="glass flex items-center gap-3 rounded-2xl border border-accent/30 px-4 py-3">
          <Flame size={16} className="text-accent" />
          <div className="text-sm">
            <span className="font-mono text-base tabular-nums text-foreground">
              {streak}
            </span>{' '}
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              day{streak === 1 ? '' : 's'} · briefed in a row
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : briefings.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {briefings.map((b) => (
            <HistoryRow
              key={b.date}
              briefing={b}
              biometrics={biometricsByDate[b.date] ?? null}
              expanded={expanded === b.date}
              onToggle={() =>
                setExpanded((prev) => (prev === b.date ? null : b.date))
              }
            />
          ))}

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="glass mt-3 w-full rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-glass-3 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}

          {!hasMore && briefings.length > 0 && (
            <p className="pt-3 text-center font-serif text-sm italic text-muted">
              That&rsquo;s the whole history.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  briefing,
  biometrics,
  expanded,
  onToggle,
}: {
  briefing: DailyBriefing;
  biometrics: BiometricsDaily | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const date = parseISO(briefing.date);
  const absolute = format(date, 'EEE, MMM d, yyyy');
  const relative = formatRelative(date);
  const workoutName = briefing.workout?.name?.trim() || 'Rest day';
  const workoutMins = briefing.workout?.duration_minutes ?? 0;
  const mealCount = briefing.meals?.length ?? 0;
  const recoveryFirst = firstSentence(briefing.recovery_note);

  return (
    <div className="glass overflow-hidden rounded-2xl transition-colors">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-glass-3"
        aria-expanded={expanded}
      >
        <div className="flex w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-glass-1 px-2 py-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-accent">
            {format(date, 'MMM')}
          </span>
          <span className="font-serif text-2xl leading-none text-foreground">
            {format(date, 'd')}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-serif text-base text-foreground">{relative}</div>
            <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-muted">
              {absolute}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Dumbbell size={11} />
              <span className="text-foreground">{workoutName}</span>
              {workoutMins > 0 && (
                <span className="font-mono tabular-nums text-muted">· {workoutMins}m</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ChefHat size={11} />
              <span className="font-mono tabular-nums text-foreground">{mealCount}</span>
              <span>meal{mealCount === 1 ? '' : 's'}</span>
            </span>
          </div>

          {recoveryFirst && (
            <p className="mt-1.5 line-clamp-1 text-xs text-muted">{recoveryFirst}</p>
          )}

          {biometrics && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {biometrics.sleep_score != null && (
                <Chip icon={<Moon size={10} />} label={`${biometrics.sleep_score}`} title="Sleep score" />
              )}
              {biometrics.hrv_ms != null && (
                <Chip icon={<Sparkles size={10} />} label={`${biometrics.hrv_ms}ms`} title="HRV" />
              )}
              {biometrics.resting_hr != null && (
                <Chip icon={<Heart size={10} />} label={`${biometrics.resting_hr}`} title="Resting HR" />
              )}
            </div>
          )}
        </div>

        <ChevronDown
          size={16}
          className={cn(
            'mt-1 flex-shrink-0 text-muted transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border bg-background/40 px-1.5 py-3 sm:px-3">
          {/*
            Read-only re-use of BriefingCard. onGenerate is required by the component's
            props but we never surface a generate button (only shown when briefing is
            null), and the regenerate button only mutates state when the user clicks it.
            Pass a no-op so the type signature is satisfied.
          */}
          <BriefingCard
            briefing={briefing}
            loading={false}
            onGenerate={async () => {
              /* read-only history view */
            }}
          />
        </div>
      )}
    </div>
  );
}

function Chip({
  icon,
  label,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-glass-1 px-2 py-0.5 font-mono text-[10px] tabular-nums text-foreground"
    >
      {icon}
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-2xl px-6 py-12 text-center">
      <CalendarDays size={32} className="mx-auto mb-3 text-muted/40" />
      <p className="font-serif text-xl text-foreground">No past briefings yet</p>
      <p className="mt-1 text-sm text-muted">
        Generate today&rsquo;s plan and it&rsquo;ll show up here tomorrow.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent"
      >
        <Sparkles size={14} />
        Go to today&rsquo;s coach
      </Link>
    </div>
  );
}

function formatRelative(date: Date): string {
  const days = differenceInCalendarDays(new Date(), date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  // Past a week, the absolute date is more informative than weeks/months ago.
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function firstSentence(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1] : trimmed;
}

/**
 * Streak = consecutive days with a briefing, counting back from yesterday
 * (today is excluded from the history list, but we still credit it if it
 * exists by virtue of the streak being unbroken). The signed-in user's
 * briefings are assumed to be for distinct dates (PK is user_id+date).
 */
function computeStreak(briefings: DailyBriefing[], todayStr: string): number {
  if (briefings.length === 0) return 0;
  const dates = new Set(briefings.map((b) => b.date));
  const today = parseISO(todayStr);
  let streak = 0;
  // Start from yesterday — today's briefing isn't in this list.
  for (let i = 1; i < 366; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = format(d, 'yyyy-MM-dd');
    if (dates.has(key)) streak++;
    else break;
  }
  return streak;
}
