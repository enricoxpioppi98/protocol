'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Moon,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { computeCyclePhase } from '@/lib/cycle/phase';
import type { CycleEntry, CyclePhase } from '@/lib/types/models';

/**
 * /settings/integrations/cycle
 *
 * Period-start log + computed-phase glass card. The phase ring is a thin
 * horizontal arc — visually a hairline on a 1-N axis with the user's
 * day_of_cycle pinned. List of past starts below with delete inline.
 */

const PHASE_LABEL: Record<CyclePhase, string> = {
  menstruation: 'Menstruation',
  follicular: 'Follicular',
  ovulation: 'Ovulation',
  luteal: 'Luteal',
  unknown: 'Unknown',
};

function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  return new Date(d.getTime() - tz * 60_000).toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function CyclePage() {
  const supabase = createClient();
  const [entries, setEntries] = useState<CycleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(todayISO());
  const [duration, setDuration] = useState<string>('5');
  const [notes, setNotes] = useState<string>('');

  const refresh = useCallback(async () => {
    const { data, error: fetchErr } = await supabase
      .from('cycle_entries')
      .select('*')
      .order('start_date', { ascending: false });
    if (fetchErr) {
      setError(fetchErr.message);
    } else {
      setEntries((data ?? []) as CycleEntry[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const phase = useMemo(
    () => computeCyclePhase(entries, new Date()),
    [entries]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!startDate) {
      setError('Start date required.');
      return;
    }
    const parsedDuration = parseInt(duration, 10);
    setBusy(true);
    try {
      const res = await fetch('/api/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          duration_days: Number.isFinite(parsedDuration) ? parsedDuration : 5,
          notes,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? 'failed to save');
        return;
      }
      setStartDate(todayISO());
      setDuration('5');
      setNotes('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this entry?')) return;
    setBusy(true);
    try {
      await fetch(`/api/cycle?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link
        href="/settings/integrations"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        Integrations
      </Link>

      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="eyebrow text-accent">Cycle</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          Menstrual phase
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Log period starts. Protocol estimates today&rsquo;s phase from your
          history and adjusts intensity prescriptions in the luteal phase
          and during menstruation.
        </p>
      </header>

      {/* Computed phase card */}
      <PhaseCard phase={phase.phase} dayOfCycle={phase.day_of_cycle} daysUntilNext={phase.days_until_next} />

      {/* Log form */}
      <section className="glass rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl border border-border bg-glass-2 p-2 text-accent">
            <Plus size={16} />
          </div>
          <h2 className="font-serif text-xl text-foreground">Log period start</h2>
        </div>

        <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" onSubmit={submit}>
          <div className="sm:col-span-1">
            <label className="eyebrow">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="eyebrow">Duration (days)</label>
            <input
              type="number"
              min={1}
              max={14}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="eyebrow">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="cramps, light"
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {error ? (
            <div className="sm:col-span-3 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle size={14} />
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="sm:col-span-3 inline-flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Plus size={14} />
            {busy ? 'Saving…' : 'Log start'}
          </button>
        </form>
      </section>

      {/* History */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="eyebrow">Logged starts</h2>
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] tabular-nums text-muted/60">
            {String(entries.length).padStart(2, '0')}
          </span>
        </div>

        {loading ? (
          <div className="glass flex justify-center rounded-2xl py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : entries.length === 0 ? (
          <div className="glass rounded-2xl px-5 py-8 text-center text-sm text-muted">
            No entries yet.
          </div>
        ) : (
          <ul className="glass divide-y divide-border rounded-2xl">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-glass-2 text-accent">
                  <Moon size={14} />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-foreground">
                    {formatDate(e.start_date)}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    {e.duration_days}-day flow
                    {e.notes ? ` · ${e.notes}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => remove(e.id)}
                  className="rounded-lg border border-border bg-glass-1 p-2 text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PhaseCard({
  phase,
  dayOfCycle,
  daysUntilNext,
}: {
  phase: CyclePhase;
  dayOfCycle: number;
  daysUntilNext: number | null;
}) {
  const isUnknown = phase === 'unknown' || dayOfCycle < 1;

  // Map day-of-cycle into a 0..1 ring position assuming a 28d default canvas.
  const RING_SCALE = 28;
  const pos =
    !isUnknown && dayOfCycle <= RING_SCALE + 7
      ? Math.min(1, Math.max(0, (dayOfCycle - 1) / RING_SCALE))
      : 0;

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-accent">Today</div>
          <div className="mt-2 font-serif text-3xl text-foreground">
            {PHASE_LABEL[phase]}
          </div>
          <div className="mt-1 text-xs text-muted">
            {isUnknown
              ? 'Log your most recent period start to compute today’s phase.'
              : `Day-of-cycle estimate based on your logged starts.`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Day
          </div>
          <div className="font-mono text-4xl tabular-nums text-foreground">
            {isUnknown ? '—' : String(dayOfCycle).padStart(2, '0')}
          </div>
          {daysUntilNext !== null && !isUnknown ? (
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {daysUntilNext}d to next
            </div>
          ) : null}
        </div>
      </div>

      {/* thin horizontal cycle ring */}
      <div className="mt-5">
        <div className="relative h-px bg-border">
          {/* phase bands */}
          <span className="absolute inset-y-0 left-0 w-[18%] bg-danger/40" title="menstruation" />
          <span className="absolute inset-y-0 left-[18%] w-[28%] bg-fiber/40" title="follicular" />
          <span className="absolute inset-y-0 left-[46%] w-[11%] bg-accent/40" title="ovulation" />
          <span className="absolute inset-y-0 left-[57%] w-[43%] bg-glass-3" title="luteal" />
          {/* user position dot */}
          {!isUnknown ? (
            <span
              className="absolute -top-[3px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-foreground shadow"
              style={{ left: `${pos * 100}%` }}
            />
          ) : null}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-muted/70">
          <span>menses</span>
          <span>follic.</span>
          <span>ovul.</span>
          <span>luteal</span>
        </div>
      </div>
    </section>
  );
}
