/**
 * Pure parsing utilities for 23andMe raw genotype downloads.
 *
 * 23andMe raw data is a TSV with one row per probed SNP:
 *
 *     # rsid    chromosome  position  genotype
 *     rs4477212    1    82154    AA
 *     rs3094315    1    752566    AG
 *     ...
 *
 * Files run 600k-1M rows and ~25MB+ uncompressed. We do NOT persist them; the
 * parser runs in the API route, filters down to the rsids in our curated
 * catalog, and the rest of the file is discarded.
 *
 * Design choices:
 * - Filter early (only keep catalog rsids) so we never hold the full map in
 *   memory.
 * - Tolerate CRLF and arbitrary whitespace between columns.
 * - Skip no-call (`--`), `00`, and any genotype with a non-ACGT character —
 *   23andMe occasionally emits I/D for indels and other noise.
 * - Hard cap at 1M data rows to bound pathological inputs.
 * - Genotype letters are sorted alphabetically so `"CA"` and `"AC"` both
 *   become `"AC"`. This matches the catalog's variant keys.
 */

import {
  APOE_TRAIT_KEY,
  CATALOG_RSIDS,
  SNP_BY_RSID,
  resolveApoeDiplotype,
} from './catalog';
import type { GenomeTrait, GenomeTraits } from '@/lib/types/models';

/** Map of rsid → alphabetically-sorted genotype string (e.g. "AC"). */
export type GenotypeMap = Record<string, string>;

const MAX_DATA_LINES = 1_000_000;
const VALID_BASES = /^[ACGT]+$/;

/**
 * Parse a 23andMe raw download. Only returns rsids that appear in our
 * curated catalog — most of the 600k+ rows are noise to us and we drop them
 * immediately to keep memory bounded.
 */
export function parseTwentyThreeAndMe(text: string): GenotypeMap {
  const out: GenotypeMap = {};
  if (!text) return out;

  // Splitting on /\r?\n/ handles both LF and CRLF line endings.
  const lines = text.split(/\r?\n/);
  let dataLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    // Strip a leading BOM on the first line if present.
    const line = i === 0 ? raw.replace(/^﻿/, '') : raw;
    if (!line || line[0] === '#') continue;

    if (++dataLineCount > MAX_DATA_LINES) break;

    // 23andMe uses tabs but be permissive — split on any run of whitespace.
    const cols = line.split(/\s+/);
    if (cols.length < 4) continue;

    const rsid = cols[0];
    const genotype = cols[3];
    if (!rsid || !genotype) continue;
    if (!CATALOG_RSIDS.has(rsid)) continue;

    const normalized = normalizeGenotype(genotype);
    if (!normalized) continue;

    out[rsid] = normalized;
  }

  return out;
}

/**
 * Normalize a raw genotype string into alphabetically-sorted ACGT letters.
 * Returns `null` for no-calls or anything outside ACGT.
 */
export function normalizeGenotype(g: string): string | null {
  if (!g) return null;
  const upper = g.toUpperCase().trim();
  if (upper === '--' || upper === '00') return null;
  if (!VALID_BASES.test(upper)) return null;
  // Sort alphabetically so "CA" → "AC", matching catalog keys.
  return upper.split('').sort().join('');
}

/**
 * Resolve a parsed `GenotypeMap` against the catalog into per-trait coaching
 * entries. Skips SNPs the user does not have, and skips compound SNPs whose
 * partners are missing.
 */
export function traitsFromGenotypes(genotypes: GenotypeMap): GenomeTraits {
  const traits: GenomeTraits = {};

  for (const entry of Object.values(SNP_BY_RSID)) {
    if (entry.compound) continue; // resolved separately below
    const genotype = genotypes[entry.rsid];
    if (!genotype) continue;

    const variant = entry.variants[genotype];
    if (!variant) continue;

    const trait: GenomeTrait = {
      value: variant.value,
      coaching: variant.coaching,
      rsid: entry.rsid,
      gene: entry.gene,
      genotype,
    };
    traits[entry.trait] = trait;
  }

  // ------------------- APOE compound (rs429358 + rs7412) -------------------
  const apoe = resolveApoeDiplotype(genotypes['rs429358'], genotypes['rs7412']);
  if (apoe) {
    const a = genotypes['rs429358'];
    const b = genotypes['rs7412'];
    traits[APOE_TRAIT_KEY] = {
      value: apoe.value,
      coaching: apoe.coaching,
      rsid: 'rs429358+rs7412',
      gene: 'APOE',
      // Combine the two genotypes for display, e.g. "rs429358:TT / rs7412:CT".
      genotype: `rs429358:${a} / rs7412:${b}`,
    };
  }

  return traits;
}
