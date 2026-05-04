'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageSquare, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useDiary } from '@/lib/hooks/useDiary';
import { useGoals } from '@/lib/hooks/useGoals';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import { entriesTotals } from '@/lib/utils/macros';
import { formatDate } from '@/lib/utils/dates';
import type { BiometricsDaily, DailyBriefing } from '@/lib/types/models';
import { BiometricsCard } from '@/components/coach/BiometricsCard';
import { MacrosCard } from '@/components/coach/MacrosCard';
import { BriefingCard } from '@/components/coach/BriefingCard';
import { ChatSlideOver } from '@/components/coach/ChatSlideOver';

/**
 * Dashboard's interactive body. Extracted from `page.tsx` (which is now an
 * async server component that loads the user and renders the server-only
 * <DataHealthCard /> above this).
 *
 * `headerSlot` is the spot where the server page injects DataHealthCard so
 * the score sits above the BiometricsCard but below the date hero. Keeping
 * the slot abstract avoids leaking the score's prop shape into this file.
 */

interface Props {
  headerSlot?: React.ReactNode;
}

export function DashboardContent({ headerSlot }: Props) {
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatDate(today), [today]);
  const supabase = useMemo(() => createClient(), []);

  const [biometrics, setBiometrics] = useState<BiometricsDaily | null>(null);
  const [biometricsHistory, setBiometricsHistory] = useState<BiometricsDaily[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editingBio, setEditingBio] = useState(false);

  const { entries } = useDiary(today);
  const { getGoalForDate } = useGoals();
  const { isOnboarded, loading: profileLoading, pinned, setPinned } = useUserProfile();
  const goal = getGoalForDate(today);
  const totals = entriesTotals(entries);

  const fetchBiometrics = useCallback(async () => {
    // Fetch the last 14 days at once — gives the BiometricsCard's trend strip
    // headroom even if a future toggle bumps `days` to 14.
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 13);
    // Read from the merged view (migration 013) so users with multiple sources
    // (Garmin + Whoop + Apple Watch) see one row per day with priority-picked
    // values, not three rows that would confuse the BiometricsCard trend strip.
    const { data } = await supabase
      .from('biometrics_daily_merged')
      .select('*')
      .gte('date', formatDate(cutoff))
      .order('date', { ascending: false });
    const rows = (data as BiometricsDaily[] | null) ?? [];
    setBiometricsHistory(rows);
    setBiometrics(rows[0] ?? null);
  }, [supabase, today]);

  const fetchBriefing = useCallback(async () => {
    const { data } = await supabase
      .from('daily_briefing')
      .select('*')
      .eq('date', todayStr)
      .maybeSingle();
    setBriefing((data as DailyBriefing | null) ?? null);
  }, [supabase, todayStr]);

  useEffect(() => {
    fetchBiometrics();
    fetchBriefing();
  }, [fetchBiometrics, fetchBriefing]);

  // Realtime: re-fetch when chat tool mutates daily_briefing.workout
  useEffect(() => {
    const ch = supabase
      .channel('dashboard_briefing_rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_briefing' },
        () => {
          fetchBriefing();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'biometrics_daily' },
        () => {
          fetchBiometrics();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, fetchBriefing, fetchBiometrics]);

  async function handleSyncGarmin() {
    const res = await fetch('/api/biometrics/sync', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('garmin sync failed', err);
      // Surface a one-shot prompt to enter manually if the service isn't configured.
      if (err?.fallback === 'manual') {
        setEditingBio(true);
      }
    }
    await fetchBiometrics();
  }

  async function handleBackfillGarmin(days: number) {
    const res = await fetch(`/api/biometrics/sync?days=${days}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('garmin backfill failed', err);
      if (err?.fallback === 'manual') {
        setEditingBio(true);
      }
    }
    await fetchBiometrics();
  }

  async function handleGenerateBriefing(regenerate: boolean) {
    setBriefingLoading(true);
    try {
      await fetch(
        `/api/briefing/today${regenerate ? '?regenerate=1' : ''}`,
        { method: 'POST' }
      );
      await fetchBriefing();
    } finally {
      setBriefingLoading(false);
    }
  }

  // Bryan-Johnson-style date numerals: 04 / 27 / 2026
  const dateLine = useMemo(() => {
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const y = today.getFullYear();
    return `${m} / ${d} / ${y}`;
  }, [today]);

  return (
    <div className="space-y-5">
      <header className="mb-2 animate-[fadeIn_0.4s_ease-out]">
        {/* Mono coordinate / dateline eyebrow */}
        <div className="flex items-center gap-3 animate-[fadeIn_0.5s_ease-out_0.05s_both]">
          <div className="eyebrow text-accent">
            {today.toLocaleDateString('en-US', { weekday: 'long' })}
          </div>
          <div className="h-px flex-1 bg-border" />
          <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
            {dateLine}
          </div>
        </div>

        {/* Display — serif month + numeric day, with italic emphasis */}
        <h1 className="mt-3 font-serif text-[56px] leading-[0.95] tracking-tight text-foreground sm:text-[68px] animate-[fadeIn_0.5s_ease-out_0.1s_both]">
          {today.toLocaleDateString('en-US', { month: 'long' })}{' '}
          <span className="italic text-muted">
            {today.toLocaleDateString('en-US', { day: 'numeric' })}
          </span>
        </h1>

        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted animate-[fadeIn_0.5s_ease-out_0.18s_both]">
          Today&rsquo;s plan, tuned overnight to last night&rsquo;s recovery
          and the past three days of training load.
        </p>
      </header>

      {!profileLoading && !isOnboarded && (
        <Link
          href="/onboarding"
          className="glass group flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all hover:bg-glass-3"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Sparkles size={15} />
          </span>
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              Complete onboarding so Protocol can tailor your plan
            </div>
            <div className="mt-0.5 text-xs text-muted">
              Goals, restrictions, equipment, weekly schedule — 2 minutes.
            </div>
          </div>
          <ArrowRight
            size={15}
            className="text-accent transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      )}

      {headerSlot}

      <BiometricsCard
        biometrics={biometrics}
        today={todayStr}
        onSync={handleSyncGarmin}
        onEdit={() => setEditingBio(true)}
        history={biometricsHistory}
        onBackfill={handleBackfillGarmin}
        pinned={pinned}
        onChangePinned={setPinned}
      />

      <MacrosCard totals={totals} goal={goal ?? null} />

      <BriefingCard
        briefing={briefing}
        loading={briefingLoading}
        onGenerate={handleGenerateBriefing}
      />

      {/* Floating chat button — glass capsule with serif "ask" */}
      <button
        onClick={() => setChatOpen(true)}
        className="glass-strong group fixed bottom-24 right-4 z-30 inline-flex items-center gap-2 rounded-full pl-4 pr-5 py-3 text-foreground shadow-[0_8px_30px_-8px_rgba(0,0,0,0.45)] transition-all hover:bg-glass-3 lg:bottom-6 lg:right-6"
        aria-label="Open coach chat"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white">
          <MessageSquare size={14} />
        </span>
        <span className="font-serif text-sm italic">ask the coach</span>
      </button>

      <ChatSlideOver
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onWorkoutChanged={fetchBriefing}
      />

      {editingBio ? (
        <ManualBiometricsModal
          existing={biometrics}
          onSave={async (vals) => {
            await fetch('/api/biometrics/sync', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(vals),
            });
            setEditingBio(false);
            await fetchBiometrics();
          }}
          onCancel={() => setEditingBio(false)}
        />
      ) : null}
    </div>
  );
}

function ManualBiometricsModal({
  existing,
  onSave,
  onCancel,
}: {
  existing: BiometricsDaily | null;
  onSave: (vals: Record<string, number | null>) => Promise<void>;
  onCancel: () => void;
}) {
  const [sleepScore, setSleepScore] = useState<string>(
    existing?.sleep_score?.toString() ?? ''
  );
  const [hrv, setHrv] = useState<string>(existing?.hrv_ms?.toString() ?? '');
  const [rhr, setRhr] = useState<string>(existing?.resting_hr?.toString() ?? '');
  const [stress, setStress] = useState<string>(
    existing?.stress_avg?.toString() ?? ''
  );
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        className="glass-strong w-full max-w-md rounded-t-2xl p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow">Manual entry</div>
        <h3 className="mt-1 font-serif text-2xl leading-tight text-foreground">
          Today&rsquo;s biometrics
        </h3>
        <p className="mt-1 text-xs text-muted">
          Used by the AI coach to tune today&rsquo;s plan.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Field label="Sleep score" value={sleepScore} onChange={setSleepScore} />
          <Field label="HRV (ms)" value={hrv} onChange={setHrv} />
          <Field label="Resting HR" value={rhr} onChange={setRhr} />
          <Field label="Stress avg" value={stress} onChange={setStress} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm text-muted transition-colors hover:bg-glass-2 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  sleep_score: parseNum(sleepScore),
                  hrv_ms: parseNum(hrv),
                  resting_hr: parseNum(rhr),
                  stress_avg: parseNum(stress),
                });
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function parseNum(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== '' ? n : null;
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
      />
    </label>
  );
}
