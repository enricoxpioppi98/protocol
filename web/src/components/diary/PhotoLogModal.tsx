'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, Loader2, Check, X, Plus, Trash2 } from 'lucide-react';
import type { MealType } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';

/**
 * PhotoLogModal — camera-based food logging via Claude Vision.
 *
 * Two-phase flow against /api/diary/photo-log:
 *
 *   1. Analyze: POST with `file` (and `meal_type`). Server runs Claude Vision
 *      and returns the parsed meal WITHOUT writing to the diary.
 *   2. Commit: POST with `items_json` (the user-edited meal) and `meal_type`.
 *      Server skips Claude and persists as Recipe + diary_entry.
 *
 * Cancelling at the result stage simply doesn't fire step 2 — no DB rows.
 */

interface PhotoLogModalProps {
  mealType: MealType;
  onClose: () => void;
  onSuccess: () => void;
}

interface AnalyzeItem {
  food: string;
  grams: number;
}

interface AnalyzeResult {
  meal_name: string;
  items: AnalyzeItem[];
  macros: { kcal: number; p: number; c: number; f: number };
}

type State =
  | { kind: 'empty' }
  | { kind: 'preview'; file: File; previewUrl: string }
  | { kind: 'uploading'; previewUrl: string }
  | {
      kind: 'result';
      previewUrl: string;
      mealName: string;
      items: AnalyzeItem[];
      originalMacros: AnalyzeResult['macros'];
      originalGrams: number;
    }
  | {
      kind: 'committing';
      previewUrl: string;
      mealName: string;
      items: AnalyzeItem[];
      originalMacros: AnalyzeResult['macros'];
      originalGrams: number;
    }
  | { kind: 'error'; message: string; previewUrl: string | null };

const MAX_LONG_EDGE = 1280;
const JPEG_QUALITY = 0.9;
const MAX_BYTES = 5 * 1024 * 1024;

export function PhotoLogModal({ mealType, onClose, onSuccess }: PhotoLogModalProps) {
  const [state, setState] = useState<State>({ kind: 'empty' });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount / state change.
  useEffect(() => {
    const url =
      'previewUrl' in state && typeof state.previewUrl === 'string' ? state.previewUrl : null;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [state]);

  const acceptFile = useCallback(async (rawFile: File) => {
    if (!rawFile.type.startsWith('image/')) {
      setState({ kind: 'error', message: 'Please pick an image file.', previewUrl: null });
      return;
    }
    let prepared: File;
    try {
      prepared = await downscaleImage(rawFile);
    } catch (err) {
      console.warn('[PhotoLogModal] downscale failed; using original', err);
      prepared = rawFile;
    }
    if (prepared.size > MAX_BYTES) {
      setState({
        kind: 'error',
        message: 'Image is too large even after compression. Try a smaller photo.',
        previewUrl: null,
      });
      return;
    }
    const previewUrl = URL.createObjectURL(prepared);
    setState({ kind: 'preview', file: prepared, previewUrl });
  }, []);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  }

  async function analyze(file: File, previewUrl: string) {
    setState({ kind: 'uploading', previewUrl });
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('meal_type', mealType);
      const res = await fetch('/api/diary/photo-log', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        const msg =
          (json && (json.detail || json.error)) || `Request failed (${res.status})`;
        setState({ kind: 'error', message: String(msg), previewUrl });
        return;
      }
      const result = json as AnalyzeResult & { phase?: string };
      const items = Array.isArray(result.items)
        ? result.items.map((it) => ({ food: String(it.food ?? ''), grams: Number(it.grams) || 0 }))
        : [];
      if (items.length === 0) {
        setState({
          kind: 'error',
          message: 'Couldn’t identify any foods in this photo. Try a clearer shot.',
          previewUrl,
        });
        return;
      }
      setState({
        kind: 'result',
        previewUrl,
        mealName: result.meal_name || 'Meal',
        items,
        originalMacros: result.macros,
        originalGrams: sumGrams(items),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: msg, previewUrl });
    }
  }

  async function commit() {
    if (state.kind !== 'result') return;
    const trimmedItems = state.items
      .map((it) => ({ food: it.food.trim(), grams: Number(it.grams) || 0 }))
      .filter((it) => it.food.length > 0 && it.grams > 0);

    if (trimmedItems.length === 0) {
      setState({
        kind: 'error',
        message: 'Add at least one food + weight before logging.',
        previewUrl: state.previewUrl,
      });
      return;
    }

    // Rescale macros: if the user changed total grams, scale macros by the
    // ratio so totals stay self-consistent rather than diverging from items.
    const origGrams = state.originalGrams;
    const newGrams = sumGrams(trimmedItems);
    const scale = origGrams > 0 && newGrams > 0 ? newGrams / origGrams : 1;
    const macros = {
      kcal: Math.max(0, state.originalMacros.kcal * scale),
      p: Math.max(0, state.originalMacros.p * scale),
      c: Math.max(0, state.originalMacros.c * scale),
      f: Math.max(0, state.originalMacros.f * scale),
    };

    setState({ ...state, kind: 'committing' });

    try {
      const form = new FormData();
      form.append('meal_type', mealType);
      form.append(
        'items_json',
        JSON.stringify({ name: state.mealName.trim() || 'Meal', items: trimmedItems, macros })
      );
      const res = await fetch('/api/diary/photo-log', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        const msg =
          (json && (json.detail || json.error)) || `Request failed (${res.status})`;
        setState({ kind: 'error', message: String(msg), previewUrl: state.previewUrl });
        return;
      }
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: msg, previewUrl: state.previewUrl });
    }
  }

  function updateItem(idx: number, patch: Partial<AnalyzeItem>) {
    if (state.kind !== 'result') return;
    const items = state.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setState({ ...state, items });
  }
  function removeItem(idx: number) {
    if (state.kind !== 'result') return;
    setState({ ...state, items: state.items.filter((_, i) => i !== idx) });
  }
  function addItem() {
    if (state.kind !== 'result') return;
    setState({ ...state, items: [...state.items, { food: '', grams: 0 }] });
  }
  function setMealName(v: string) {
    if (state.kind !== 'result') return;
    setState({ ...state, mealName: v });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Snap a meal"
    >
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl glass-strong sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-5 pt-5 pb-3">
          <div>
            <div className="eyebrow mb-1">{stateLabel(state)}</div>
            <h2 className="font-serif text-2xl leading-tight">Snap a meal</h2>
            <p className="mt-0.5 text-xs text-muted">
              Logging to <span className="font-medium text-foreground">{mealType}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.kind === 'empty' && (
            <EmptyState
              dragOver={dragOver}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onPickClick={() => fileInputRef.current?.click()}
            />
          )}

          {(state.kind === 'preview' || state.kind === 'uploading') && (
            <div className="flex flex-col gap-4">
              <PreviewImage src={state.previewUrl} dim={state.kind === 'uploading'} />
              {state.kind === 'uploading' && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin text-accent" />
                  <span>Identifying meal&hellip;</span>
                </div>
              )}
            </div>
          )}

          {(state.kind === 'result' || state.kind === 'committing') && (
            <ResultEditor
              previewUrl={state.previewUrl}
              mealName={state.mealName}
              items={state.items}
              originalMacros={state.originalMacros}
              originalGrams={state.originalGrams}
              readOnly={state.kind === 'committing'}
              onMealNameChange={setMealName}
              onUpdate={updateItem}
              onRemove={removeItem}
              onAdd={addItem}
            />
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col gap-3">
              {state.previewUrl && <PreviewImage src={state.previewUrl} dim={false} />}
              <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
                {state.message}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-glass-1 px-5 py-3">
          {state.kind === 'empty' && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Camera size={16} />
              Take or pick a photo
            </button>
          )}

          {state.kind === 'preview' && (
            <>
              <button
                onClick={() => setState({ kind: 'empty' })}
                className="rounded-xl px-4 py-2.5 text-sm text-muted transition-colors hover:bg-card-hover hover:text-foreground"
              >
                Retake
              </button>
              <button
                onClick={() => analyze(state.file, state.previewUrl)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Upload size={16} />
                Analyze
              </button>
            </>
          )}

          {state.kind === 'uploading' && (
            <button
              disabled
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent/60 py-2.5 text-sm font-semibold text-white"
            >
              <Loader2 size={16} className="animate-spin" />
              Working&hellip;
            </button>
          )}

          {state.kind === 'result' && (
            <>
              <button
                onClick={onClose}
                className="rounded-xl px-4 py-2.5 text-sm text-muted transition-colors hover:bg-card-hover hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Check size={16} />
                Log meal
              </button>
            </>
          )}

          {state.kind === 'committing' && (
            <button
              disabled
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent/60 py-2.5 text-sm font-semibold text-white"
            >
              <Loader2 size={16} className="animate-spin" />
              Logging&hellip;
            </button>
          )}

          {state.kind === 'error' && (
            <button
              onClick={() => setState({ kind: 'empty' })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPickFile}
        />
      </div>
    </div>
  );
}

/* ============================================================
   Subcomponents
   ============================================================ */

function EmptyState(props: {
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPickClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onPickClick}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-12 text-center transition-colors',
        props.dragOver
          ? 'border-accent bg-accent/5'
          : 'border-border bg-glass-1 hover:border-accent/40 hover:bg-card-hover'
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Camera size={26} />
      </div>
      <div>
        <p className="font-serif text-lg leading-tight">Snap or drop a photo</p>
        <p className="mt-1 text-xs text-muted">
          JPEG, PNG, or WebP &middot; up to 5&nbsp;MB
        </p>
      </div>
    </button>
  );
}

function PreviewImage({ src, dim }: { src: string; dim: boolean }) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-glass-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="meal preview"
        className={cn(
          'h-full w-full object-cover transition-opacity',
          dim ? 'opacity-60' : 'opacity-100'
        )}
      />
      {dim && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Loader2 size={28} className="animate-spin text-white" />
        </div>
      )}
    </div>
  );
}

function ResultEditor(props: {
  previewUrl: string;
  mealName: string;
  items: AnalyzeItem[];
  originalMacros: AnalyzeResult['macros'];
  originalGrams: number;
  readOnly: boolean;
  onMealNameChange: (v: string) => void;
  onUpdate: (idx: number, patch: Partial<AnalyzeItem>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  // Live totals: scale Claude's totals by the ratio of edited grams to the
  // ORIGINAL grams snapshot from analyze. Stays self-consistent as the user
  // adjusts portion sizes.
  const totalGrams = sumGrams(props.items);
  const display = {
    kcal: scaleMacro(props.originalMacros.kcal, totalGrams, props.originalGrams),
    p: scaleMacro(props.originalMacros.p, totalGrams, props.originalGrams),
    c: scaleMacro(props.originalMacros.c, totalGrams, props.originalGrams),
    f: scaleMacro(props.originalMacros.f, totalGrams, props.originalGrams),
  };

  return (
    <div className={cn('flex flex-col gap-4', props.readOnly && 'pointer-events-none opacity-70')}>
      <PreviewImage src={props.previewUrl} dim={false} />

      <div>
        <div className="eyebrow mb-1">Identified</div>
        <input
          value={props.mealName}
          onChange={(e) => props.onMealNameChange(e.target.value)}
          className="w-full bg-transparent font-serif text-xl leading-tight focus:outline-none"
          placeholder="Meal name"
        />
      </div>

      {/* Items */}
      <div className="rounded-xl border border-border bg-glass-1">
        {props.items.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-muted">
            No items. Add one to log this meal.
          </p>
        )}
        {props.items.map((item, idx) => (
          <ItemRow
            key={idx}
            item={item}
            onUpdate={(patch) => props.onUpdate(idx, patch)}
            onRemove={() => props.onRemove(idx)}
          />
        ))}
        <button
          onClick={props.onAdd}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm text-accent transition-colors hover:bg-accent/5"
        >
          <Plus size={14} />
          Add row
        </button>
      </div>

      {/* Totals */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-glass-1 px-4 py-3">
        <div className="eyebrow">Totals</div>
        <div className="flex items-center gap-3 numerals text-xs">
          <span>{Math.round(display.kcal)} kcal</span>
          <span className="text-accent">{Math.round(display.p)}p</span>
          <span className="text-highlight">{Math.round(display.c)}c</span>
          <span className="text-fat">{Math.round(display.f)}f</span>
        </div>
      </div>
    </div>
  );
}

function ItemRow(props: {
  item: AnalyzeItem;
  onUpdate: (patch: Partial<AnalyzeItem>) => void;
  onRemove: () => void;
}) {
  const { item } = props;
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <input
        value={item.food}
        onChange={(e) => props.onUpdate({ food: e.target.value })}
        placeholder="Food"
        className="flex-1 bg-transparent px-1 py-1 text-sm placeholder:text-muted/60 focus:outline-none"
      />
      <input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(item.grams) ? item.grams : 0}
        onChange={(e) => props.onUpdate({ grams: Number(e.target.value) || 0 })}
        className="w-16 rounded-md bg-glass-2 px-2 py-1 text-right text-sm numerals focus:outline-none focus:ring-1 focus:ring-accent"
        min={0}
        step={1}
      />
      <span className="text-[10px] text-muted">g</span>
      <button
        onClick={props.onRemove}
        aria-label="Remove row"
        className="rounded-md p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function stateLabel(state: State): string {
  switch (state.kind) {
    case 'empty':
      return 'New entry';
    case 'preview':
      return 'Ready';
    case 'uploading':
      return 'Analyzing';
    case 'result':
      return 'Identified';
    case 'committing':
      return 'Logging';
    case 'error':
      return 'Error';
  }
}

function sumGrams(items: AnalyzeItem[]): number {
  return items.reduce(
    (acc, it) => acc + (Number.isFinite(it.grams) && it.grams > 0 ? it.grams : 0),
    0
  );
}

function scaleMacro(base: number, currentGrams: number, refGrams: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(refGrams) || refGrams <= 0) return base;
  if (!Number.isFinite(currentGrams) || currentGrams <= 0) return 0;
  return base * (currentGrams / refGrams);
}

/**
 * Client-side downscale: load image, draw to canvas capped at MAX_LONG_EDGE
 * on the long edge, export as JPEG to keep the upload small. If the result
 * is somehow LARGER than the original (rare for already-tiny images), fall
 * back to the original.
 */
async function downscaleImage(file: File): Promise<File> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('image load failed'));
    i.src = dataUrl;
  });

  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = long > MAX_LONG_EDGE ? MAX_LONG_EDGE / long : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) return file;

  if (blob.size >= file.size && file.type === 'image/jpeg') {
    return file;
  }

  return new File([blob], renameToJpeg(file.name), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function renameToJpeg(name: string): string {
  if (/\.(jpe?g)$/i.test(name)) return name;
  return name.replace(/\.[^./\\]+$/, '') + '.jpg';
}
