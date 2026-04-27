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

export default function DashboardPage() {
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
  const { isOnboarded, loading: profileLoading } = useUserProfile();
  const goal = getGoalForDate(today);
  const totals = entriesTotals(entries);

  const fetchBiometrics = useCallback(async () => {
    // Fetch the last 14 days at once — gives the BiometricsCard's trend strip
    // headroom even if a future toggle bumps `days` to 14.
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 13);
    const { data } = await supabase
      .from('biometrics_daily')
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

  return (
    <div className="space-y-4">
      <header className="mb-2 animate-[fadeIn_0.4s_ease-out]">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent animate-[fadeIn_0.5s_ease-out_0.05s_both]"
        >
          {today.toLocaleDateString('en-US', { weekday: 'long' })}
        </div>
        <h1
          className="mt-1 text-4xl font-bold leading-none tracking-tight text-foreground sm:text-5xl animate-[fadeIn_0.5s_ease-out_0.1s_both]"
        >
          {today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </h1>
        <p
          className="mt-2 text-sm text-muted animate-[fadeIn_0.5s_ease-out_0.18s_both]"
        >
          Your plan for today, tuned to last night&rsquo;s recovery.
        </p>
      </header>

      {!profileLoading && !isOnboarded && (
        <Link
          href="/onboarding"
          className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 transition-colors hover:bg-accent/15"
        >
          <Sparkles size={18} className="text-accent" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">
              Finish onboarding so Protocol can tailor your plan
            </div>
            <div className="text-xs text-muted">
              Goals, restrictions, equipment, weekly schedule — 2 minutes.
            </div>
          </div>
          <ArrowRight size={16} className="text-accent" />
        </Link>
      )}

      <BiometricsCard
        biometrics={biometrics}
        today={todayStr}
        onSync={handleSyncGarmin}
        onEdit={() => setEditingBio(true)}
        history={biometricsHistory}
        onBackfill={handleBackfillGarmin}
      />

      <MacrosCard totals={totals} goal={goal ?? null} />

      <BriefingCard
        briefing={briefing}
        loading={briefingLoading}
        onGenerate={handleGenerateBriefing}
      />

      {/* Floating chat button */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-24 right-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-105 lg:bottom-6"
        aria-label="Open coach chat"
      >
        <MessageSquare size={22} />
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-card p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-foreground">
          Enter today&rsquo;s biometrics
        </h3>
        <p className="mb-4 text-xs text-muted">
          Used by the AI coach to tune today&rsquo;s plan.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sleep score" value={sleepScore} onChange={setSleepScore} />
          <Field label="HRV (ms)" value={hrv} onChange={setHrv} />
          <Field label="Resting HR" value={rhr} onChange={setRhr} />
          <Field label="Stress avg" value={stress} onChange={setStress} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-card-hover"
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
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground outline-none ring-1 ring-border focus:ring-accent"
      />
    </label>
  );
}
