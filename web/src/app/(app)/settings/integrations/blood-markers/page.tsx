'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Beaker,
  Upload,
  FileText,
  Plus,
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import type { BloodMarkerReading, BloodPanel } from '@/lib/types/models';

/**
 * /settings/integrations/blood-markers
 *
 * Two ingest paths:
 *   1. "Upload panel PDF" → POST /api/blood-panels/parse-pdf → preview modal
 *      → user confirms → POST /api/blood-panels to persist.
 *   2. "Enter manually" → on-page form → POST /api/blood-panels.
 *
 * Below: list of past panels (date + lab), expandable to show readings with
 * a thin reference-range bar per marker.
 */

interface DraftReading {
  marker: string;
  value: string; // string while editing, parsed on submit
  unit: string;
  reference_low: string;
  reference_high: string;
}

const DEFAULT_DRAFT: DraftReading = {
  marker: '',
  value: '',
  unit: 'mg/dL',
  reference_low: '',
  reference_high: '',
};

function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  return new Date(d.getTime() - tz * 60_000).toISOString().slice(0, 10);
}

function formatPanelDate(iso: string): string {
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

export default function BloodMarkersPage() {
  const supabase = createClient();
  const [panels, setPanels] = useState<BloodPanel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showManual, setShowManual] = useState(false);
  const [parseModal, setParseModal] = useState<ParsedDraft | null>(null);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: fetchErr } = await supabase
      .from('blood_panels')
      .select('*, readings:blood_marker_readings(*)')
      .order('panel_date', { ascending: false });
    if (fetchErr) {
      setError(fetchErr.message);
    } else {
      setPanels((data ?? []) as BloodPanel[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setUploadingFile(file.name);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/blood-panels/parse-pdf', {
        method: 'POST',
        body: form,
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) {
        setError(j?.error ?? `parse failed (${res.status})`);
        return;
      }
      // Convert parsed readings into editable drafts so the user can correct
      // any misreads before persisting.
      const drafts: DraftReading[] = (j.readings as ParsedReadingResp[]).map(
        (r) => ({
          marker: r.marker,
          value: String(r.value),
          unit: r.unit,
          reference_low:
            r.reference_low !== null && r.reference_low !== undefined
              ? String(r.reference_low)
              : '',
          reference_high:
            r.reference_high !== null && r.reference_high !== undefined
              ? String(r.reference_high)
              : '',
        })
      );
      setParseModal({
        panel_date: j.panel_date,
        lab: j.lab ?? '',
        notes: '',
        readings: drafts,
        source: 'pdf_upload',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploadingFile(null);
    }
  }, []);

  async function commit(draft: ParsedDraft) {
    setBusy(true);
    setError(null);
    try {
      const readings = draft.readings
        .map(parseDraft)
        .filter((r): r is ValidReading => r !== null);
      if (readings.length === 0) {
        setError('At least one valid reading required.');
        return;
      }
      const res = await fetch('/api/blood-panels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panel_date: draft.panel_date,
          lab: draft.lab,
          notes: draft.notes,
          source: draft.source,
          readings,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(j?.error ?? 'failed to save');
        return;
      }
      setParseModal(null);
      setShowManual(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this panel and all its readings?')) return;
    setBusy(true);
    try {
      await fetch(`/api/blood-panels?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
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
        <div className="eyebrow text-accent">Bloodwork</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          Blood markers
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Quarterly panels — apoB, hsCRP, hbA1c, lipid, hormones. Upload the
          lab PDF for auto-parse, or enter values by hand.
        </p>
      </header>

      {/* Ingest affordances */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Upload PDF */}
        <button
          type="button"
          disabled={!!uploadingFile}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'glass group flex items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-glass-3',
            uploadingFile && 'cursor-wait opacity-70'
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Upload size={18} />
          </span>
          <div className="flex-1">
            <div className="font-serif text-base text-foreground">
              {uploadingFile ? `Parsing ${uploadingFile}…` : 'Upload panel PDF'}
            </div>
            <div className="text-xs text-muted">
              PDF or photo — Claude reads markers + ranges.
            </div>
          </div>
          {uploadingFile ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          ) : (
            <span className="font-mono text-muted transition-transform group-hover:translate-x-0.5">
              &rsaquo;
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />

        {/* Manual */}
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="glass group flex items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-glass-3"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-glass-2 text-foreground">
            <Beaker size={18} />
          </span>
          <div className="flex-1">
            <div className="font-serif text-base text-foreground">Enter manually</div>
            <div className="text-xs text-muted">
              Type values by hand for one panel.
            </div>
          </div>
          <span className="font-mono text-muted transition-transform group-hover:translate-x-0.5">
            {showManual ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle size={14} />
          {error}
        </div>
      ) : null}

      {showManual ? (
        <ManualPanelForm
          busy={busy}
          onCancel={() => setShowManual(false)}
          onSubmit={(draft) => commit(draft)}
        />
      ) : null}

      {/* Past panels */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center gap-3">
          <h2 className="eyebrow">Past panels</h2>
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] tabular-nums text-muted/60">
            {String(panels.length).padStart(2, '0')}
          </span>
        </div>

        {loading ? (
          <div className="glass flex justify-center rounded-2xl py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : panels.length === 0 ? (
          <div className="glass rounded-2xl px-5 py-8 text-center text-sm text-muted">
            No panels logged yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {panels.map((p) => (
              <PanelCard key={p.id} panel={p} onDelete={() => remove(p.id)} />
            ))}
          </ul>
        )}
      </section>

      {/* Confirmation modal — parsed-PDF preview */}
      {parseModal ? (
        <PanelConfirmModal
          draft={parseModal}
          busy={busy}
          onChange={setParseModal}
          onCancel={() => setParseModal(null)}
          onConfirm={() => parseModal && commit(parseModal)}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- subviews

function ManualPanelForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (draft: ParsedDraft) => void;
}) {
  const [panelDate, setPanelDate] = useState(todayISO());
  const [lab, setLab] = useState('');
  const [notes, setNotes] = useState('');
  const [readings, setReadings] = useState<DraftReading[]>([{ ...DEFAULT_DRAFT }]);

  function update(i: number, patch: Partial<DraftReading>) {
    setReadings((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setReadings((rs) => [...rs, { ...DEFAULT_DRAFT }]);
  }
  function removeRow(i: number) {
    setReadings((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  return (
    <div className="glass space-y-4 rounded-2xl p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="eyebrow">Panel date</label>
          <input
            type="date"
            value={panelDate}
            onChange={(e) => setPanelDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
          />
        </div>
        <div>
          <label className="eyebrow">Lab</label>
          <input
            type="text"
            value={lab}
            onChange={(e) => setLab(e.target.value)}
            placeholder="Quest Diagnostics"
            className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h3 className="eyebrow">Markers</h3>
          <span className="h-px flex-1 bg-border" />
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-glass-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-glass-3"
          >
            <Plus size={12} /> Add
          </button>
        </div>

        {readings.map((r, i) => (
          <ReadingDraftRow
            key={i}
            draft={r}
            canRemove={readings.length > 1}
            onChange={(patch) => update(i, patch)}
            onRemove={() => removeRow(i)}
          />
        ))}
      </div>

      <div>
        <label className="eyebrow">Notes</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="post-fast, AM draw"
          className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onSubmit({
              panel_date: panelDate,
              lab,
              notes,
              readings,
              source: 'manual',
            })
          }
          className="flex-1 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save panel'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border bg-glass-1 px-4 py-2 text-sm text-muted transition-colors hover:bg-glass-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReadingDraftRow({
  draft,
  canRemove,
  onChange,
  onRemove,
}: {
  draft: DraftReading;
  canRemove: boolean;
  onChange: (patch: Partial<DraftReading>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2">
      <input
        className="col-span-3 rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-accent/60"
        placeholder="ldl"
        value={draft.marker}
        onChange={(e) => onChange({ marker: e.target.value })}
      />
      <input
        className="col-span-2 rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60"
        placeholder="92"
        type="number"
        step="any"
        value={draft.value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
      <input
        className="col-span-2 rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-accent/60"
        placeholder="mg/dL"
        value={draft.unit}
        onChange={(e) => onChange({ unit: e.target.value })}
      />
      <input
        className="col-span-2 rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60"
        placeholder="ref low"
        type="number"
        step="any"
        value={draft.reference_low}
        onChange={(e) => onChange({ reference_low: e.target.value })}
      />
      <input
        className="col-span-2 rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60"
        placeholder="ref high"
        type="number"
        step="any"
        value={draft.reference_high}
        onChange={(e) => onChange({ reference_high: e.target.value })}
      />
      <button
        type="button"
        disabled={!canRemove}
        onClick={onRemove}
        className="col-span-1 flex items-center justify-center rounded-xl border border-border bg-glass-1 text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-30"
        title="Remove"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function PanelCard({
  panel,
  onDelete,
}: {
  panel: BloodPanel;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const readings = panel.readings ?? [];

  return (
    <li className="glass rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-glass-2 text-accent">
          <FileText size={16} />
        </span>
        <div className="flex-1">
          <div className="font-serif text-base text-foreground">
            {formatPanelDate(panel.panel_date)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            {panel.lab || 'Unknown lab'} · {readings.length} markers
          </div>
        </div>
        <span className="font-mono text-muted">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border px-5 py-4">
          {readings.length === 0 ? (
            <div className="text-sm text-muted">No markers on this panel.</div>
          ) : (
            <ul className="space-y-3">
              {readings.map((r) => (
                <MarkerRow key={r.id} reading={r} />
              ))}
            </ul>
          )}
          <div className="pt-2">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger/20"
            >
              <Trash2 size={12} /> Delete panel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function MarkerRow({ reading }: { reading: BloodMarkerReading }) {
  const flag = reading.flag;
  const flagColor =
    flag === 'high'
      ? 'text-danger'
      : flag === 'low'
        ? 'text-accent'
        : flag === 'normal'
          ? 'text-fiber'
          : 'text-muted';

  return (
    <li className="grid grid-cols-12 items-center gap-3">
      <div className="col-span-3 font-mono text-xs uppercase tracking-[0.14em] text-foreground">
        {reading.marker}
      </div>
      <div className="col-span-2 font-mono text-base tabular-nums text-foreground">
        {reading.value}
      </div>
      <div className="col-span-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {reading.unit}
      </div>
      <div className="col-span-4">
        <RangeBar reading={reading} />
      </div>
      <div
        className={`col-span-1 text-right font-mono text-[10px] uppercase tracking-[0.14em] ${flagColor}`}
      >
        {flag ?? '—'}
      </div>
    </li>
  );
}

function RangeBar({ reading }: { reading: BloodMarkerReading }) {
  const lo = reading.reference_low;
  const hi = reading.reference_high;
  if (lo === null || hi === null || hi <= lo) {
    return <div className="h-px bg-border" />;
  }
  // Map value into the [lo, hi] axis with clamped overflow on either side.
  const span = hi - lo;
  const pad = span * 0.5;
  const axisMin = lo - pad;
  const axisMax = hi + pad;
  const pct = Math.max(
    0,
    Math.min(100, ((reading.value - axisMin) / (axisMax - axisMin)) * 100)
  );
  const loPct = ((lo - axisMin) / (axisMax - axisMin)) * 100;
  const hiPct = ((hi - axisMin) / (axisMax - axisMin)) * 100;

  return (
    <div className="relative h-1 rounded-full bg-glass-2">
      {/* in-range band */}
      <div
        className="absolute inset-y-0 rounded-full bg-fiber/40"
        style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }}
      />
      {/* user value */}
      <div
        className="absolute -top-1 h-3 w-0.5 -translate-x-1/2 rounded-sm bg-foreground"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

function PanelConfirmModal({
  draft,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  draft: ParsedDraft;
  busy: boolean;
  onChange: (next: ParsedDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function patchReading(i: number, patch: Partial<DraftReading>) {
    onChange({
      ...draft,
      readings: draft.readings.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    });
  }
  function addReading() {
    onChange({ ...draft, readings: [...draft.readings, { ...DEFAULT_DRAFT }] });
  }
  function removeReading(i: number) {
    onChange({
      ...draft,
      readings: draft.readings.filter((_, idx) => idx !== i),
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <CheckCircle2 size={18} />
          </span>
          <div className="flex-1">
            <h2 className="font-serif text-2xl text-foreground">Confirm panel</h2>
            <p className="text-xs text-muted">
              Review parsed values before saving. Edit anything that looks off.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-glass-1 p-2 text-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="eyebrow">Panel date</label>
            <input
              type="date"
              value={draft.panel_date}
              onChange={(e) => onChange({ ...draft, panel_date: e.target.value })}
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none focus:border-accent/60"
            />
          </div>
          <div>
            <label className="eyebrow">Lab</label>
            <input
              type="text"
              value={draft.lab}
              onChange={(e) => onChange({ ...draft, lab: e.target.value })}
              className="mt-1 w-full rounded-xl border border-border bg-glass-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="eyebrow">Markers</h3>
            <span className="h-px flex-1 bg-border" />
            <button
              type="button"
              onClick={addReading}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-glass-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent hover:bg-glass-3"
            >
              <Plus size={12} /> Add
            </button>
          </div>
          {draft.readings.map((r, i) => (
            <ReadingDraftRow
              key={i}
              draft={r}
              canRemove={draft.readings.length > 1}
              onChange={(patch) => patchReading(i, patch)}
              onRemove={() => removeReading(i)}
            />
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save panel'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-border bg-glass-1 px-4 py-2 text-sm text-muted transition-colors hover:bg-glass-3"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- types

interface ParsedReadingResp {
  marker: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
}

interface ParsedDraft {
  panel_date: string;
  lab: string;
  notes: string;
  readings: DraftReading[];
  source: 'manual' | 'pdf_upload';
}

interface ValidReading {
  marker: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
}

function parseDraft(d: DraftReading): ValidReading | null {
  const marker = d.marker.trim();
  const unit = d.unit.trim();
  const value = parseFloat(d.value);
  if (!marker || !unit || !Number.isFinite(value)) return null;
  const lo = d.reference_low.trim() ? parseFloat(d.reference_low) : NaN;
  const hi = d.reference_high.trim() ? parseFloat(d.reference_high) : NaN;
  return {
    marker,
    value,
    unit,
    reference_low: Number.isFinite(lo) ? lo : null,
    reference_high: Number.isFinite(hi) ? hi : null,
  };
}

