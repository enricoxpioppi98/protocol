'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Droplet, Plus, Trash2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { GlucoseContext, GlucoseReading } from '@/lib/types/models';

/**
 * /settings/integrations/cgm
 *
 * Manual-entry CGM glucose page. Logs sub-daily mg/dL readings with an optional
 * context tag (fasting / pre_meal / post_meal / overnight / workout / random).
 * The Supabase realtime publication keeps the list in sync if a second tab
 * adds a row.
 */

const CONTEXT_OPTIONS: { value: GlucoseContext; label: string }[] = [
  { value: 'fasting', label: 'Fasting' },
  { value: 'pre_meal', label: 'Pre-meal' },
  { value: 'post_meal', label: 'Post-meal' },
  { value: 'overnight', label: 'Overnight' },
  { value: 'workout', label: 'Workout' },
  { value: 'random', label: 'Random' },
];

function nowLocalDatetimeInput(): string {
  // Returns "YYYY-MM-DDTHH:MM" in the user's local timezone, suitable for an
  // <input type="datetime-local"> default. We don't carry seconds here; the
  // server stores a full ISO timestamp so this is a fine resolution.
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatRecordedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function tirBucket(mgDl: number): 'low' | 'in_range' | 'high' {
  if (mgDl < 70) return 'low';
  if (mgDl > 140) return 'high';
  return 'in_range';
}

export default function CGMPage() {
  const supabase = createClient();
  const [readings, setReadings] = useState<GlucoseReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recordedAt, setRecordedAt] = useState<string>(nowLocalDatetimeInput());
  const [mgDl, setMgDl] = useState<string>('');
  const [contextValue, setContextValue] = useState<GlucoseContext | ''>('');
  const [notes, setNotes] = useState<string>('');

  const refresh = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data, error: fetchErr } = await supabase
      .from('glucose_readings')
      .select('*')
      .gte('recorded_at', since.toISOString())
      .order('recorded_at', { ascending: false });
    if (fetchErr) {
      setError(fetchErr.message);
    } else {
      setReadings((data ?? []) as GlucoseReading[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const value = parseFloat(mgDl);
    if (!Number.isFinite(value) || value <= 0 || value >= 1000) {
      setError('mg/dL must be a number between 1 and 999.');
      return;
    }
    if (!recordedAt) {
      setError('Recorded timestamp required.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/glucose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // datetime-local has no timezone — ISO it via a Date round-trip so
          // the server records the user's local moment in UTC.
          recorded_at: new Date(recordedAt).toISOString(),
          mg_dl: Math.round(value),
          context: contextValue || undefined,
          notes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'failed to save');
        return;
      }
      setMgDl('');
      setNotes('');
      setContextValue('');
      setRecordedAt(nowLocalDatetimeInput());
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this reading?')) return;
    setBusy(true);
    try {
      await fetch(`/api/glucose?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
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
        <div className="eyebrow text-accent">Glucose</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          CGM
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Manual continuous-glucose entries in mg/dL. Tag context so the coach
          can read fasting vs. post-meal correctly.
        </p>
      </header>

      {/* Manual entry form */}
      <section className="glass rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl border border-border bg-glass-2 p-2 text-accent">
            <Droplet size={16} />
          </div>
          <h2 className="font-serif text-xl text-foreground">Log a reading</h2>
        </div>

        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="sm:col-span-1">
            <label className="eyebrow">Timestamp</label>
            <input
              type="datetime-local"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="eyebrow">mg/dL</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={mgDl}
              onChange={(e) => setMgDl(e.target.value)}
              placeholder="98"
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="eyebrow">Context</label>
            <select
              value={contextValue}
              onChange={(e) => setContextValue(e.target.value as GlucoseContext | '')}
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            >
              <option value="">—</option>
              {CONTEXT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-1">
            <label className="eyebrow">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="post-run"
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {error ? (
            <div className="sm:col-span-2 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle size={14} />
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Plus size={14} />
            {busy ? 'Saving…' : 'Log reading'}
          </button>
        </form>
      </section>

      {/* History */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="eyebrow">Last 30 days</h2>
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] tabular-nums text-muted/60">
            {String(readings.length).padStart(2, '0')}
          </span>
        </div>

        {loading ? (
          <div className="glass flex justify-center rounded-2xl py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : readings.length === 0 ? (
          <div className="glass rounded-2xl px-5 py-8 text-center text-sm text-muted">
            No readings yet. Log one above to get started.
          </div>
        ) : (
          <ul className="glass divide-y divide-border rounded-2xl">
            {readings.map((r) => (
              <ReadingRow key={r.id} reading={r} onDelete={() => remove(r.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReadingRow({
  reading,
  onDelete,
}: {
  reading: GlucoseReading;
  onDelete: () => void;
}) {
  const bucket = tirBucket(reading.mg_dl);
  const bucketColor =
    bucket === 'in_range'
      ? 'text-fiber'
      : bucket === 'low'
        ? 'text-accent'
        : 'text-danger';

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="w-28 shrink-0">
        <div className={`font-mono text-lg tabular-nums ${bucketColor}`}>
          {reading.mg_dl}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
          mg/dL
        </div>
      </div>
      <div className="flex-1">
        <div className="text-sm text-foreground">
          {formatRecordedAt(reading.recorded_at)}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          {reading.context ?? '—'}
          {reading.notes ? ` · ${reading.notes}` : ''}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="rounded-lg border border-border bg-glass-1 p-2 text-muted transition-colors hover:border-danger/40 hover:text-danger"
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
