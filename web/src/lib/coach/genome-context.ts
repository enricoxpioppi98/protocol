/**
 * Track 13: genome × coaching overlay.
 *
 * Self-contained helper that turns the user's stored `genome_traits` (Track K /
 * migration 008) into a small, prompt-friendly list of *fitness/lifestyle*
 * flags the coach can phrase advice around. Track 14 plugs the output into
 * `lib/coach/context.ts` — this file does NOT touch the prompt assembler.
 *
 * What we surface:
 *   - caffeine                 → CYP1A2 rs762551
 *   - lactose                  → MCM6 rs4988235
 *   - power_vs_endurance       → ACTN3 rs1815739
 *   - cardio_recovery          → PPARGC1A rs8192678
 *   - sleep_chronotype         → PER3 rs228697 (or CLOCK rs1801260 fallback)
 *   - cortisol_response        → COMT rs4680
 *   - iron_storage             → HFE rs1800562 (C282Y) + rs1799945 (H63D)
 *   - alcohol_metabolism       → ADH1B rs1229984
 *   - fat_metabolism           → APOE compound (rs429358 + rs7412)
 *
 * What we deliberately do NOT surface:
 *   - Disease-prediction SNPs (BRCA, full APOE Alzheimer framing, etc.). The
 *     `lib/genome/catalog.ts` is already lifestyle-only by design, but this
 *     file applies an explicit allow-list rather than passing every catalog
 *     trait through. Anything not in the allow-list is filtered.
 *
 * Confidence tiers:
 *   - high   — well-replicated effect in the literature AND a clear
 *              actionable lever (caffeine timing, dairy tolerance, alcohol).
 *   - medium — consistent literature with smaller or context-dependent
 *              effect (training response, chronotype, COMT).
 *   - low    — exploratory; reserved for future additions.
 */

import { getAdminClient } from '@/lib/supabase/admin';
import { SNP_BY_RSID, APOE_TRAIT_KEY } from '@/lib/genome/catalog';
import type { GenomeTraits, GenomeTrait } from '@/lib/types/models';

// ---------------------------------------------------------------- public types

export interface GenomeFlag {
  category:
    | 'caffeine'
    | 'lactose'
    | 'power_vs_endurance'
    | 'cardio_recovery'
    | 'sleep_chronotype'
    | 'cortisol_response'
    | 'iron_storage'
    | 'alcohol_metabolism'
    | 'fat_metabolism';
  /** Human-friendly label, e.g. "slow caffeine metabolism". */
  label: string;
  /** dbSNP rsid the flag is derived from (or compound key for APOE). */
  rsid: string;
  /** User's actual genotype, alphabetically sorted (e.g. "AA", "AC"). */
  genotype: string;
  /** 1-2 sentence note the coach can paraphrase verbatim. */
  interpretation: string;
  /** Strength of literature behind the flag. */
  confidence: 'low' | 'medium' | 'high';
  /** Where in the day this flag is most actionable. */
  actionable_in:
    | 'morning'
    | 'training'
    | 'meals'
    | 'sleep'
    | 'recovery'
    | 'general';
}

// ---------------------------------------------------------------- internal config
//
// Each entry maps a single catalog trait key (snake_case, see `SNP_CATALOG[i].trait`)
// to a `GenomeFlag` shape, plus a per-genotype label that's friendlier to the
// coach than the catalog's `value` (e.g. "slow caffeine metabolism" instead of
// "slow metabolizer", which would read ambiguous on its own).

interface SingleSnpFlagSpec {
  kind: 'single';
  category: GenomeFlag['category'];
  /** Catalog `trait` key (e.g. "caffeine_metabolism"). */
  traitKey: string;
  confidence: GenomeFlag['confidence'];
  actionable_in: GenomeFlag['actionable_in'];
  /** Per-genotype human label override. Falls back to `trait.value`. */
  labelByGenotype?: Record<string, string>;
}

interface ApoeFlagSpec {
  kind: 'apoe';
  category: GenomeFlag['category'];
  confidence: GenomeFlag['confidence'];
  actionable_in: GenomeFlag['actionable_in'];
  /** Per-diplotype label (keys match `resolveApoeDiplotype`'s `value`). */
  labelByDiplotype: Record<string, string>;
}

type FlagSpec = SingleSnpFlagSpec | ApoeFlagSpec;

/**
 * Allow-list of categories we expose to the coach, in priority order. Anything
 * not on this list is filtered out — keeps the helper safe even if the catalog
 * grows to include health-disease SNPs in the future.
 *
 * The order here also defines the order of the returned flags array, which
 * `summarizeForPrompt` preserves.
 */
const FLAG_SPECS: FlagSpec[] = [
  {
    kind: 'single',
    category: 'caffeine',
    traitKey: 'caffeine_metabolism',
    confidence: 'high',
    actionable_in: 'morning',
    labelByGenotype: {
      AA: 'fast caffeine metabolism',
      AC: 'slow caffeine metabolism',
      CC: 'slow caffeine metabolism',
    },
  },
  {
    kind: 'single',
    category: 'lactose',
    traitKey: 'lactose_tolerance',
    confidence: 'high',
    actionable_in: 'meals',
    labelByGenotype: {
      AA: 'lactose persistent',
      AG: 'lactose persistent',
      GG: 'lactose non-persistent',
    },
  },
  {
    kind: 'single',
    category: 'power_vs_endurance',
    traitKey: 'muscle_fiber_bias',
    confidence: 'medium',
    actionable_in: 'training',
    labelByGenotype: {
      CC: 'power-biased ACTN3',
      CT: 'mixed ACTN3 fiber profile',
      TT: 'endurance-biased ACTN3',
    },
  },
  {
    kind: 'single',
    category: 'cardio_recovery',
    traitKey: 'vo2max_trainability',
    confidence: 'medium',
    actionable_in: 'training',
    labelByGenotype: {
      GG: 'strong VO2 trainability (PPARGC1A)',
      AG: 'typical VO2 trainability (PPARGC1A)',
      AA: 'slower VO2 response (PPARGC1A)',
    },
  },
  {
    kind: 'single',
    category: 'sleep_chronotype',
    traitKey: 'circadian_preference',
    confidence: 'medium',
    actionable_in: 'sleep',
    labelByGenotype: {
      CC: 'morning chronotype (PER3)',
      CG: 'intermediate chronotype (PER3)',
      GG: 'evening chronotype (PER3)',
    },
  },
  {
    // Fallback chronotype source if PER3 isn't called for this user. We only
    // emit this when `circadian_preference` is missing — see selection logic
    // in `flagsFromTraits`.
    kind: 'single',
    category: 'sleep_chronotype',
    traitKey: 'chronotype_clock',
    confidence: 'medium',
    actionable_in: 'sleep',
    labelByGenotype: {
      AA: 'morning chronotype (CLOCK)',
      AG: 'intermediate chronotype (CLOCK)',
      GG: 'evening chronotype (CLOCK)',
    },
  },
  {
    kind: 'single',
    category: 'cortisol_response',
    traitKey: 'dopamine_clearance',
    confidence: 'medium',
    actionable_in: 'recovery',
    labelByGenotype: {
      AA: 'worrier COMT (slow dopamine clearance)',
      AG: 'mixed COMT',
      GG: 'warrior COMT (fast dopamine clearance)',
    },
  },
  {
    kind: 'single',
    category: 'iron_storage',
    traitKey: 'iron_absorption',
    confidence: 'high',
    actionable_in: 'meals',
    labelByGenotype: {
      GG: 'typical iron absorption (HFE C282Y)',
      AG: 'mildly elevated iron absorption (HFE C282Y carrier)',
      AA: 'high iron absorption (HFE C282Y/C282Y)',
    },
  },
  {
    // H63D — secondary HFE site. Only emitted if the C282Y trait is missing
    // OR if the user is heterozygous/homozygous for H63D (the additional
    // signal is most actionable when iron loading is plausible).
    kind: 'single',
    category: 'iron_storage',
    traitKey: 'iron_absorption_h63d',
    confidence: 'medium',
    actionable_in: 'meals',
    labelByGenotype: {
      CC: 'no H63D iron flag',
      CG: 'mildly elevated iron absorption (HFE H63D carrier)',
      GG: 'elevated iron absorption (HFE H63D/H63D)',
    },
  },
  {
    kind: 'single',
    category: 'alcohol_metabolism',
    traitKey: 'alcohol_metabolism',
    confidence: 'high',
    actionable_in: 'general',
    labelByGenotype: {
      AA: 'very fast alcohol metabolism (ADH1B)',
      AG: 'fast alcohol metabolism (ADH1B)',
      GG: 'typical alcohol metabolism (ADH1B)',
    },
  },
  {
    kind: 'apoe',
    category: 'fat_metabolism',
    confidence: 'medium',
    actionable_in: 'meals',
    labelByDiplotype: {
      'ε3/ε3': 'APOE ε3/ε3 (typical lipid handling)',
      'ε2/ε3': 'APOE ε2 carrier (lipid handling)',
      'ε2/ε2': 'APOE ε2/ε2 (atypical lipid handling)',
      'ε3/ε4': 'APOE ε4 carrier (sat-fat sensitive)',
      'ε4/ε4': 'APOE ε4/ε4 (sat-fat sensitive)',
      'ambiguous (ε1/ε3 or ε2/ε4)': 'APOE genotype ambiguous',
    },
  },
];

/**
 * Categories considered safe to surface to the coach. Anything outside this
 * set is filtered before returning, even if a future catalog edit adds a
 * spec for it. Defense-in-depth against accidental health-disease leakage.
 */
const ALLOWED_CATEGORIES: ReadonlySet<GenomeFlag['category']> = new Set<
  GenomeFlag['category']
>([
  'caffeine',
  'lactose',
  'power_vs_endurance',
  'cardio_recovery',
  'sleep_chronotype',
  'cortisol_response',
  'iron_storage',
  'alcohol_metabolism',
  'fat_metabolism',
]);

// ---------------------------------------------------------------- public API

/**
 * Fetch the user's stored genome traits and return the subset the coach
 * should personalize against. Returns `[]` cleanly when:
 *   - the user has no `user_profile` row,
 *   - the user has not uploaded their genome,
 *   - the DB read fails (logged, not thrown — coaching context degrades
 *     gracefully rather than failing the briefing).
 */
export async function relevantGenomeFlags(opts: {
  userId: string;
  /** Categories to filter to. Default: all allowed categories. */
  categories?: GenomeFlag['category'][];
}): Promise<GenomeFlag[]> {
  const { userId, categories } = opts;
  if (!userId) return [];

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('user_profile')
    .select('genome_traits')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[genome-context] fetch error', error);
    return [];
  }
  if (!data) return [];

  const traits = (data as { genome_traits?: GenomeTraits | null })
    .genome_traits;
  if (!traits || typeof traits !== 'object') return [];

  const flags = flagsFromTraits(traits);

  // Apply caller filter if provided. Always apply the category allow-list.
  const wanted = categories ? new Set(categories) : null;
  return flags.filter((f) => {
    if (!ALLOWED_CATEGORIES.has(f.category)) return false;
    if (wanted && !wanted.has(f.category)) return false;
    return true;
  });
}

/**
 * Render flags as a multi-line block for the prompt. Returns an empty string
 * when there are no flags, so callers can do `prefix + summary` safely.
 *
 * Format (one line per flag):
 *
 *   - <category>: <label> (<gene> <rsid> <genotype>) — <interpretation>
 *
 * Wrapped in a "Genomic context (lifestyle SNPs):" header so the LLM has a
 * clear signal that these are personalization inputs, not facts to recite.
 */
export function summarizeForPrompt(flags: GenomeFlag[]): string {
  if (!flags || flags.length === 0) return '';

  const lines: string[] = ['Genomic context (lifestyle SNPs):'];
  for (const f of flags) {
    lines.push(
      `- ${f.category}: ${f.label} (${f.rsid} ${f.genotype}) — ${f.interpretation}`
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- internals

/**
 * Pure transform: catalog-derived `GenomeTraits` → ordered `GenomeFlag[]`.
 * Exported for testability; call-site is `relevantGenomeFlags`.
 */
export function flagsFromTraits(traits: GenomeTraits): GenomeFlag[] {
  const out: GenomeFlag[] = [];
  const hasPer3 = Boolean(traits['circadian_preference']);
  const hasC282y = Boolean(traits['iron_absorption']);

  for (const spec of FLAG_SPECS) {
    if (spec.kind === 'apoe') {
      const flag = buildApoeFlag(traits, spec);
      if (flag) out.push(flag);
      continue;
    }

    // Single-SNP path.
    // Skip the CLOCK chronotype fallback if PER3 already produced a flag —
    // we don't want two competing chronotype lines in the prompt.
    if (spec.traitKey === 'chronotype_clock' && hasPer3) continue;

    // Skip the H63D row when:
    //   - C282Y has already produced an "elevated" flag (avoid double-warn),
    //   - the user is C/C at H63D AND we already emitted a C282Y line (the
    //     "no H63D flag" line is noise on top of an existing iron read).
    if (spec.traitKey === 'iron_absorption_h63d') {
      const h63d = traits['iron_absorption_h63d'];
      if (!h63d) continue;
      if (hasC282y && h63d.genotype === 'CC') continue;
    }

    const trait = traits[spec.traitKey];
    if (!trait) continue;

    const flag = buildSingleFlag(trait, spec);
    if (flag) out.push(flag);
  }

  return out;
}

function buildSingleFlag(
  trait: GenomeTrait,
  spec: SingleSnpFlagSpec
): GenomeFlag | null {
  // Belt-and-suspenders: confirm the rsid still maps back to the catalog. If
  // a future catalog edit removes the SNP we want to drop the flag rather
  // than emit a stale interpretation.
  if (!SNP_BY_RSID[trait.rsid]) return null;

  const label =
    spec.labelByGenotype?.[trait.genotype] ?? trait.value ?? 'unknown';

  return {
    category: spec.category,
    label,
    rsid: trait.rsid,
    genotype: trait.genotype,
    interpretation: trait.coaching,
    confidence: spec.confidence,
    actionable_in: spec.actionable_in,
  };
}

function buildApoeFlag(
  traits: GenomeTraits,
  spec: ApoeFlagSpec
): GenomeFlag | null {
  const apoe = traits[APOE_TRAIT_KEY];
  if (!apoe) return null;

  // Don't surface the ambiguous diplotype with confident framing — drop the
  // confidence to "low" and keep the interpretation as the catalog wrote it
  // (which already says "no specific dietary guidance is implied").
  const isAmbiguous = apoe.value.startsWith('ambiguous');
  const label =
    spec.labelByDiplotype[apoe.value] ?? `APOE ${apoe.value}`;

  return {
    category: spec.category,
    label,
    rsid: apoe.rsid, // "rs429358+rs7412"
    genotype: apoe.genotype, // "rs429358:TT / rs7412:CT"
    interpretation: apoe.coaching,
    confidence: isAmbiguous ? 'low' : spec.confidence,
    actionable_in: spec.actionable_in,
  };
}
