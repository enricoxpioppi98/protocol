'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dna,
  Upload,
  FileText,
  Microscope,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import { SNP_CATALOG } from '@/lib/genome/catalog';
import { cn } from '@/lib/utils/cn';
import type { GenomeTrait, GenomeTraits } from '@/lib/types/models';

/**
 * /genome — upload a 23andMe raw download, parse it server-side against the
 * curated SNP catalog, and surface coaching traits grouped by category.
 *
 * The raw genotypes never leave the request body; only derived traits are
 * persisted on `user_profile.genome_traits` and made available to the AI
 * coach via Track L's prompt-context layer.
 */

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string }
  | { status: 'success'; filename: string; count: number; matched: number }
  | { status: 'error'; message: string };

const TWENTY_THREE_AND_ME_INSTRUCTIONS_URL =
  'https://customercare.23andme.com/hc/en-us/articles/212196868';

// Category order for the rendered trait sections — surfaces the most
// actionable groups first.
const CATEGORY_ORDER: Array<
  'Metabolism' | 'Performance' | 'Sleep' | 'Cardio' | 'Nutrition' | 'Cognition'
> = ['Metabolism', 'Performance', 'Sleep', 'Cardio', 'Nutrition', 'Cognition'];

/** Key → category lookup, derived from the catalog. APOE compound trait is
 *  resolved separately under "Cardio". */
const TRAIT_TO_CATEGORY: Record<string, (typeof CATEGORY_ORDER)[number]> = (() => {
  const out: Record<string, (typeof CATEGORY_ORDER)[number]> = {};
  for (const entry of SNP_CATALOG) {
    if (entry.compound) continue;
    out[entry.trait] = entry.category;
  }
  out['apoe_genotype'] = 'Cardio';
  return out;
})();

/** Pretty-print snake_case trait id → "Title Case". */
function prettyTraitName(traitKey: string): string {
  return traitKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatUploadedAt(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

export default function GenomePage() {
  const { profile, loading, refetch } = useUserProfile();
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const traits = profile?.genome_traits ?? {};
  const hasTraits = Object.keys(traits).length > 0;

  const grouped = useMemo(() => groupByCategory(traits), [traits]);

  const handleFile = useCallback(
    async (file: File) => {
      setUploadState({ status: 'uploading', filename: file.name });
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/genome/upload', {
          method: 'POST',
          body: form,
        });
        const json = (await res.json().catch(() => null)) as
          | {
              error?: string;
              count?: number;
              matched_rsids?: number;
            }
          | null;
        if (!res.ok) {
          setUploadState({
            status: 'error',
            message: json?.error ?? `Upload failed (${res.status})`,
          });
          return;
        }
        setUploadState({
          status: 'success',
          filename: file.name,
          count: json?.count ?? 0,
          matched: json?.matched_rsids ?? 0,
        });
        await refetch();
      } catch (err) {
        setUploadState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [refetch]
  );

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = ''; // allow re-selecting the same file
    },
    [handleFile]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const uploadedAt = formatUploadedAt(profile?.genome_uploaded_at ?? null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-light text-accent">
          <Dna size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Genome</h1>
          <p className="text-sm text-muted">
            Upload your 23andMe raw data to personalize coaching.
          </p>
        </div>
      </div>

      {/* Upload affordance */}
      <UploadCard
        isDragging={isDragging}
        setIsDragging={setIsDragging}
        onDrop={onDrop}
        onPick={() => fileInputRef.current?.click()}
        uploadState={uploadState}
        hasTraits={hasTraits}
        uploadedAt={uploadedAt}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.tsv,text/plain,text/tab-separated-values"
        className="hidden"
        onChange={onPickFile}
      />

      {/* Privacy note — important to surface plainly */}
      <PrivacyNote />

      {/* Coach-context banner after a successful upload */}
      {uploadState.status === 'success' && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent-light px-4 py-3 text-sm text-foreground">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-accent" />
          <p>
            Matched <strong>{uploadState.matched}</strong> SNPs from the catalog into{' '}
            <strong>{uploadState.count}</strong> coaching traits. These traits are now
            part of your AI coach context.
          </p>
        </div>
      )}

      {/* Empty state vs. results */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : hasTraits ? (
        <TraitsSections grouped={grouped} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- subviews

function UploadCard({
  isDragging,
  setIsDragging,
  onDrop,
  onPick,
  uploadState,
  hasTraits,
  uploadedAt,
}: {
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: () => void;
  uploadState: UploadState;
  hasTraits: boolean;
  uploadedAt: string | null;
}) {
  const uploading = uploadState.status === 'uploading';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-2xl border-2 border-dashed bg-card px-6 py-8 text-center transition-colors',
        isDragging
          ? 'border-accent bg-accent-light'
          : 'border-border hover:border-accent/40'
      )}
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-light text-accent">
        <Upload size={22} />
      </div>
      <p className="font-semibold text-foreground">
        {hasTraits ? 'Re-upload to refresh traits' : 'Upload your 23andMe raw data'}
      </p>
      <p className="mt-1 text-sm text-muted">
        Drag a .txt or .tsv file here, or click to choose.
      </p>
      <button
        type="button"
        disabled={uploading}
        onClick={onPick}
        className={cn(
          'mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity',
          uploading && 'cursor-not-allowed opacity-60'
        )}
      >
        {uploading ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Parsing {uploadState.filename}…
          </>
        ) : (
          <>
            <FileText size={16} />
            Choose file
          </>
        )}
      </button>

      {uploadState.status === 'error' && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle size={14} />
          {uploadState.message}
        </div>
      )}

      {uploadedAt && uploadState.status !== 'uploading' && (
        <p className="mt-4 text-xs text-muted/80">Last upload: {uploadedAt}</p>
      )}

      <a
        href={TWENTY_THREE_AND_ME_INSTRUCTIONS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-xs text-accent hover:underline"
      >
        How to download your 23andMe raw data
      </a>
    </div>
  );
}

function PrivacyNote() {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-card px-4 py-3 text-xs text-muted">
      <Microscope size={16} className="mt-0.5 shrink-0 text-muted" />
      <p>
        We parse the file in-memory and only persist a small set of derived
        coaching traits — your raw genotypes never go to the database.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-card px-6 py-10 text-center">
      <Dna size={32} className="mx-auto mb-3 text-muted/50" />
      <p className="font-semibold text-foreground">No genome on file yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Upload your 23andMe raw download to surface lifestyle-coaching traits for
        caffeine, training response, sleep timing, and more. The AI coach will
        weave them into briefings.
      </p>
    </div>
  );
}

function TraitsSections({
  grouped,
}: {
  grouped: Record<string, Array<[string, GenomeTrait]>>;
}) {
  const presentCategories = CATEGORY_ORDER.filter(
    (cat) => grouped[cat] && grouped[cat].length > 0
  );

  if (presentCategories.length === 0) {
    // Shouldn't happen if hasTraits is true, but defensive.
    return null;
  }

  return (
    <div className="space-y-6">
      {presentCategories.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {category}
          </h2>
          <div className="space-y-3">
            {grouped[category].map(([traitKey, trait]) => (
              <TraitCard key={traitKey} traitKey={traitKey} trait={trait} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TraitCard({ traitKey, trait }: { traitKey: string; trait: GenomeTrait }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {prettyTraitName(traitKey)}
          </p>
          <p className="text-xs text-muted">
            {trait.gene} · {trait.rsid}
          </p>
        </div>
        <div className="shrink-0 rounded-lg bg-card-hover px-2 py-1 font-mono text-xs text-foreground">
          {trait.genotype}
        </div>
      </div>
      <p className="mt-3 text-sm font-medium text-accent">{trait.value}</p>
      <p className="mt-1 text-sm text-muted">{trait.coaching}</p>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function groupByCategory(
  traits: GenomeTraits
): Record<string, Array<[string, GenomeTrait]>> {
  const out: Record<string, Array<[string, GenomeTrait]>> = {};
  for (const [traitKey, trait] of Object.entries(traits)) {
    const category = TRAIT_TO_CATEGORY[traitKey] ?? 'Metabolism';
    if (!out[category]) out[category] = [];
    out[category].push([traitKey, trait]);
  }
  return out;
}
