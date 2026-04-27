/**
 * Curated catalog of SNPs we read from a 23andMe raw download and surface as
 * coaching traits. Every entry is restricted to *lifestyle* implications —
 * caffeine, training, sleep, alcohol, vitamin/mineral status — never disease
 * prediction or diagnostic claims.
 *
 * Genotype keys are alphabetically sorted (e.g. always `"AC"`, never `"CA"`)
 * so the parser can do a single normalize-then-lookup.
 *
 * APOE is special: it's a compound genotype defined by two SNPs (rs429358 +
 * rs7412). It does not fit the single-SNP shape so it's resolved separately
 * in `traitsFromGenotypes`. The two SNPs are still in the catalog (with
 * `compound: true`) so the parser will pick them up off the raw file, but the
 * single-SNP `variants` map is intentionally empty for them.
 *
 * ACE rs1799752 is an indel and 23andMe does not report it consistently in
 * v3/v4/v5 raw downloads. We deliberately omit it to avoid surfacing a
 * `"genotype: --"` row that would confuse users.
 */

export interface SNPVariant {
  /** Plain-English value for the variant, e.g. "fast metabolizer". */
  value: string;
  /**
   * 1-2 sentence lifestyle coaching note. Specific and actionable. No
   * medical or disease claims — this is coaching context for the AI, not a
   * diagnostic.
   */
  coaching: string;
}

export interface SNPEntry {
  /** dbSNP identifier, e.g. "rs762551". Always lowercase "rs". */
  rsid: string;
  /** Gene symbol the SNP sits in or near. */
  gene: string;
  /**
   * Stable trait identifier we use as a key in `genome_traits`. snake_case.
   * Changing this is a breaking change — old rows in user_profile will keep
   * the old key.
   */
  trait: string;
  /** What the trait means in plain English (one sentence). */
  description: string;
  /**
   * Map of alphabetically-sorted genotype string ("AA" | "AC" | "CC") to
   * variant interpretation. Empty for compound SNPs (handled separately).
   */
  variants: Record<string, SNPVariant>;
  /**
   * Loose grouping for the UI. Determines which card section the trait is
   * rendered in on the /genome page.
   */
  category: 'Metabolism' | 'Performance' | 'Sleep' | 'Cardio' | 'Nutrition' | 'Cognition';
  /**
   * If true, this SNP is one input to a compound trait (e.g. APOE) and is
   * not interpreted on its own. The parser still records the genotype.
   */
  compound?: boolean;
  /** Citation note (PMID, dbSNP, or trusted summary). */
  source?: string;
}

export const SNP_CATALOG: SNPEntry[] = [
  // ---------------------------------------------------------------- METABOLISM
  {
    rsid: 'rs762551',
    gene: 'CYP1A2',
    trait: 'caffeine_metabolism',
    description: 'How quickly the liver clears caffeine.',
    category: 'Metabolism',
    variants: {
      AA: {
        value: 'fast metabolizer',
        coaching:
          'Fast caffeine metabolizer. Caffeine clears quickly so a mid-afternoon coffee rarely disrupts sleep, and you may need slightly higher doses for a pre-workout effect.',
      },
      AC: {
        value: 'slow metabolizer',
        coaching:
          'Slow caffeine metabolizer. Cap caffeine at 1-2 cups before noon; later doses will linger and chip away at sleep quality more than for fast metabolizers.',
      },
      CC: {
        value: 'slow metabolizer',
        coaching:
          'Slow caffeine metabolizer. Treat caffeine as a morning-only tool, and consider a hard cutoff by 10am on training days when sleep matters most.',
      },
    },
    source: 'Cornelis et al., JAMA 2006 (PMID: 16522833); dbSNP rs762551',
  },
  {
    rsid: 'rs1229984',
    gene: 'ADH1B',
    trait: 'alcohol_metabolism',
    description: 'Speed of converting alcohol to acetaldehyde.',
    category: 'Metabolism',
    variants: {
      // 23andMe reports this on the reverse strand for some chips; here we
      // use the forward-strand convention: A = *48His (fast), G = *1 (typical).
      AA: {
        value: 'very fast metabolizer',
        coaching:
          'Very fast alcohol metabolizer — acetaldehyde builds up quickly, so you may flush, feel hot, or get a headache after even a small drink. Lean toward zero-alcohol or sip slowly with food.',
      },
      AG: {
        value: 'fast metabolizer',
        coaching:
          'Fast alcohol metabolizer. You may notice flushing or a heavier next-morning hit than peers; pace drinks and hydrate aggressively if you do drink.',
      },
      GG: {
        value: 'typical metabolizer',
        coaching:
          'Typical alcohol metabolism. No metabolic flag — but training-recovery effects of alcohol still apply, especially on lifting nights.',
      },
    },
    source: 'Edenberg, Alcohol Res Health 2007 (PMID: 17718394)',
  },
  {
    rsid: 'rs9939609',
    gene: 'FTO',
    trait: 'appetite_satiety',
    description: 'Appetite-regulation variant linked to satiety after meals.',
    category: 'Metabolism',
    variants: {
      AA: {
        value: 'lower satiety response',
        coaching:
          'You may feel less full after meals than peers. Lean on protein-forward, high-fiber meals (30g+ protein, 8g+ fiber) and pre-plan snacks so hunger does not drive impulse choices.',
      },
      AT: {
        value: 'mixed satiety response',
        coaching:
          'Mixed satiety profile. Protein-forward breakfasts and slow-digesting carbs (oats, lentils) help blunt mid-morning hunger; track whether liquid calories disproportionately leave you hungry.',
      },
      TT: {
        value: 'typical satiety response',
        coaching:
          'Typical FTO profile — no appetite-regulation flag. Standard hunger cues are reliable for you.',
      },
    },
    source: 'Frayling et al., Science 2007 (PMID: 17434869)',
  },
  {
    rsid: 'rs4988235',
    gene: 'MCM6',
    trait: 'lactose_tolerance',
    description: 'Lifelong ability to digest lactose into adulthood (LCT regulator).',
    category: 'Nutrition',
    variants: {
      AA: {
        value: 'lactose tolerant',
        coaching:
          'Lactose persistent — dairy is a fine protein/carb source for you. Greek yogurt and milk are easy lever foods for hitting protein targets.',
      },
      AG: {
        value: 'lactose tolerant',
        coaching:
          'Lactose persistent (heterozygote). Dairy generally tolerated; if you do notice GI symptoms it is more likely volume-related than enzymatic.',
      },
      GG: {
        value: 'lactose intolerant',
        coaching:
          'Lactose non-persistent. Expect GI symptoms with non-fermented dairy in volume; lactose-free milk, hard cheeses, and yogurt (mostly fermented out) are usually well tolerated.',
      },
    },
    source: 'Enattah et al., Nat Genet 2002 (PMID: 11788828)',
  },
  {
    rsid: 'rs1800562',
    gene: 'HFE',
    trait: 'iron_absorption',
    description: 'C282Y variant influencing dietary iron absorption.',
    category: 'Nutrition',
    variants: {
      // G = wild type, A = C282Y risk allele (forward strand convention).
      GG: {
        value: 'typical iron absorption',
        coaching:
          'No iron-loading flag. Standard iron guidance applies; pair plant iron with vitamin C if anemia or low ferritin shows up on labs.',
      },
      AG: {
        value: 'mildly elevated absorption',
        coaching:
          'Carrier of the C282Y variant. You may absorb dietary iron slightly more efficiently than average; avoid stacking high-dose iron supplements without a ferritin panel first.',
      },
      AA: {
        value: 'high iron absorption',
        coaching:
          'Genotype associated with high iron absorption. Avoid iron supplements and iron-fortified products by default, and ask a clinician to check ferritin/transferrin saturation before any iron-stacking protocol.',
      },
    },
    source: 'Feder et al., Nat Genet 1996 (PMID: 8696333)',
  },
  {
    rsid: 'rs1801133',
    gene: 'MTHFR',
    trait: 'folate_metabolism',
    description: 'C677T variant affecting folate methylation efficiency.',
    category: 'Nutrition',
    variants: {
      // G = C (wild type, normal enzyme), A = T (677T, reduced enzyme).
      GG: {
        value: 'typical folate processing',
        coaching:
          'Standard folate processing. A diet with leafy greens, legumes, and fortified grains is enough to meet folate needs.',
      },
      AG: {
        value: 'mildly reduced enzyme activity',
        coaching:
          'Heterozygous C677T. Mildly reduced folate methylation — emphasize naturally folate-rich foods (spinach, lentils, asparagus) and consider methylfolate over plain folic acid if you supplement.',
      },
      AA: {
        value: 'reduced enzyme activity',
        coaching:
          'Homozygous C677T. Folate methylation runs slower; prioritize folate-rich whole foods daily, and if you supplement choose 5-MTHF (methylfolate) rather than folic acid.',
      },
    },
    source: 'Frosst et al., Nat Genet 1995 (PMID: 7647779)',
  },
  {
    rsid: 'rs2228570',
    gene: 'VDR',
    trait: 'vitamin_d_receptor',
    description: 'FokI variant in the vitamin D receptor.',
    category: 'Nutrition',
    variants: {
      // T = f (less efficient), C = F (more efficient receptor).
      CC: {
        value: 'efficient VDR signaling',
        coaching:
          'Efficient vitamin D receptor. Standard sun + dietary intake is usually sufficient; check 25(OH)D once a year if you live above ~40° latitude.',
      },
      CT: {
        value: 'mixed VDR signaling',
        coaching:
          'Mixed vitamin D receptor activity. Prioritize daily sun exposure (15-20 min when UV is meaningful) and vitamin-D-rich foods (fatty fish, eggs); test serum 25(OH)D in winter if you train hard.',
      },
      TT: {
        value: 'less efficient VDR signaling',
        coaching:
          'Less efficient vitamin D receptor. Be deliberate about year-round vitamin D status — outdoor sun exposure, fatty fish, and a tested winter supplementation plan keep performance and recovery on track.',
      },
    },
    source: 'Uitterlinden et al., Gene 2004 (PMID: 15225980)',
  },

  // --------------------------------------------------------------- PERFORMANCE
  {
    rsid: 'rs1815739',
    gene: 'ACTN3',
    trait: 'muscle_fiber_bias',
    description: 'α-actinin-3 expression in fast-twitch fibers (R577X).',
    category: 'Performance',
    variants: {
      // C = R (functional, power), T = X (stop codon, endurance bias).
      CC: {
        value: 'power-biased',
        coaching:
          'Power/sprint-biased fiber profile. You likely respond well to heavy compound lifts and short sprint intervals; recover well from low-rep, high-load sessions.',
      },
      CT: {
        value: 'mixed power/endurance',
        coaching:
          'Mixed fiber profile — flexible across modalities. A balanced program (heavy lifts + Z2 + occasional VO2 work) tends to work; you do not need to specialize.',
      },
      TT: {
        value: 'endurance-biased',
        coaching:
          'Endurance-biased fiber profile (no functional α-actinin-3). You likely thrive on sustained aerobic work and higher-rep, time-under-tension training; pure max-strength singles may feel harder than for peers.',
      },
    },
    source: 'Yang et al., Am J Hum Genet 2003 (PMID: 12879365)',
  },
  {
    rsid: 'rs8192678',
    gene: 'PPARGC1A',
    trait: 'vo2max_trainability',
    description: 'Gly482Ser variant influencing mitochondrial biogenesis response to training.',
    category: 'Performance',
    variants: {
      // G = Gly (typical), A = Ser (blunted response).
      GG: {
        value: 'strong VO2 trainability',
        coaching:
          'Strong VO2 trainability. Structured Z2 + 1-2x weekly VO2-max intervals will reliably lift aerobic capacity; you tend to see measurable gains within 6-8 weeks.',
      },
      AG: {
        value: 'typical VO2 trainability',
        coaching:
          'Typical aerobic-trainability profile. Standard polarized training (mostly Z2 + a small amount of high-intensity work) builds VO2 max effectively.',
      },
      AA: {
        value: 'slower VO2 response',
        coaching:
          'Slightly slower VO2 response. Stay patient with aerobic blocks (12+ weeks) and prioritize consistency of Z2 volume over chasing intensity early.',
      },
    },
    source: 'Steinbacher et al., Eur J Appl Physiol 2015 (PMID: 25430432)',
  },

  // --------------------------------------------------------------------- SLEEP
  {
    rsid: 'rs228697',
    gene: 'PER3',
    trait: 'circadian_preference',
    description: 'PER3 variant associated with morning vs. evening preference.',
    category: 'Sleep',
    variants: {
      CC: {
        value: 'morning-leaning',
        coaching:
          'Morning-leaning chronotype. Schedule hardest training and deep work before noon; aim for lights-out by 10:30pm to protect early-morning quality.',
      },
      CG: {
        value: 'intermediate',
        coaching:
          'Intermediate chronotype. You have flexibility — anchor on consistent wake-time more than absolute clock hour, and let training time shift with life.',
      },
      GG: {
        value: 'evening-leaning',
        coaching:
          'Evening-leaning chronotype. Late-morning/afternoon training tends to feel best; if work demands early starts, get bright light within 10 minutes of waking.',
      },
    },
    source: 'Archer et al., Sleep 2003 (PMID: 12683481)',
  },
  {
    rsid: 'rs1801260',
    gene: 'CLOCK',
    trait: 'chronotype_clock',
    description: '3111T>C variant in the CLOCK gene linked to evening preference.',
    category: 'Sleep',
    variants: {
      // A = T (typical), G = C (later chronotype).
      AA: {
        value: 'morning-leaning chronotype',
        coaching:
          'CLOCK gene leans morning. Front-load demanding work; protect a consistent bedtime — late nights cost more for you than for evening types.',
      },
      AG: {
        value: 'intermediate chronotype',
        coaching:
          'Intermediate CLOCK profile. Honor your natural sleep window when possible; consistency matters more than timing.',
      },
      GG: {
        value: 'evening-leaning chronotype',
        coaching:
          'CLOCK gene leans evening. Forcing 5am wake-ups will erode recovery — if your schedule allows, push the sleep window 30-60 min later and protect it.',
      },
    },
    source: 'Katzenberg et al., Sleep 1998 (PMID: 9779517)',
  },

  // --------------------------------------------------------------------- CARDIO
  {
    rsid: 'rs7903146',
    gene: 'TCF7L2',
    trait: 'glucose_response',
    description: 'Variant linked to post-meal glucose handling.',
    category: 'Cardio',
    variants: {
      CC: {
        value: 'typical glucose handling',
        coaching:
          'Typical post-meal glucose response. Standard balanced meals work; no special carb-timing flag.',
      },
      CT: {
        value: 'mildly slower glucose handling',
        coaching:
          'Slightly slower glucose handling. Pair carbs with protein and fiber, walk 10 minutes after large meals, and lean on whole-food carbs over refined ones.',
      },
      TT: {
        value: 'slower glucose handling',
        coaching:
          'Slower post-meal glucose handling. Front-load carbs around training, prefer minimally processed carbs (oats, legumes, whole fruit), and aim for a short post-meal walk on big-carb days.',
      },
    },
    source: 'Grant et al., Nat Genet 2006 (PMID: 16415884)',
  },
  // APOE compound genotype: rs429358 + rs7412 → ε2/ε3/ε4. Single-SNP variants
  // are intentionally empty; resolved by the compound handler in parser.ts.
  {
    rsid: 'rs429358',
    gene: 'APOE',
    trait: 'apoe_rs429358',
    description: 'Component of the APOE ε2/ε3/ε4 compound genotype (lipid handling).',
    category: 'Cardio',
    compound: true,
    variants: {},
    source: 'dbSNP rs429358; resolved jointly with rs7412.',
  },
  {
    rsid: 'rs7412',
    gene: 'APOE',
    trait: 'apoe_rs7412',
    description: 'Component of the APOE ε2/ε3/ε4 compound genotype (lipid handling).',
    category: 'Cardio',
    compound: true,
    variants: {},
    source: 'dbSNP rs7412; resolved jointly with rs429358.',
  },

  // ----------------------------------------------------------------- COGNITION
  {
    rsid: 'rs4680',
    gene: 'COMT',
    trait: 'dopamine_clearance',
    description: 'Val158Met — speed of dopamine clearance from the prefrontal cortex.',
    category: 'Cognition',
    variants: {
      // A = Met (slow), G = Val (fast).
      AA: {
        value: 'slow clearance ("worrier")',
        coaching:
          'Slow dopamine clearance. You likely focus deeply but are more sensitive to caffeine + stress stacking; cap caffeine before high-stakes work and protect wind-down time before bed.',
      },
      AG: {
        value: 'mixed clearance',
        coaching:
          'Mixed dopamine clearance. Flexible cognitive profile — pay attention to how caffeine + acute stress interact for you specifically.',
      },
      GG: {
        value: 'fast clearance ("warrior")',
        coaching:
          'Fast dopamine clearance. Performs well under acute stress and tolerates caffeine well; benefits from stimulating environments and clear deadlines for deep work.',
      },
    },
    source: 'Stein et al., Neuropsychopharmacology 2006 (PMID: 16395299)',
  },
];

/** Lookup by rsid. Built once at module load. */
export const SNP_BY_RSID: Record<string, SNPEntry> = Object.fromEntries(
  SNP_CATALOG.map((entry) => [entry.rsid, entry])
);

/** All rsids the parser should keep when filtering a 23andMe file. */
export const CATALOG_RSIDS: ReadonlySet<string> = new Set(
  SNP_CATALOG.map((entry) => entry.rsid)
);

// ---------------------------------------------------------------- APOE COMPOUND
// APOE is the canonical compound case in this catalog: the ε2/ε3/ε4 alleles
// are defined by the joint state of two SNPs (rs429358 + rs7412), and the
// coaching note depends on the diplotype rather than either SNP alone.
//
// Allele rules (forward strand):
//   rs429358:  T = ε3/ε2 base, C = ε4
//   rs7412:    C = ε3/ε4 base, T = ε2
//
// Per-haplotype:
//   ε2 = T (rs429358) + T (rs7412)
//   ε3 = T (rs429358) + C (rs7412)
//   ε4 = C (rs429358) + C (rs7412)
//
// We can only call the diplotype unambiguously when both SNPs are homozygous
// or one is homozygous (e.g. rs429358 = TT + rs7412 = CT → ε2/ε3). The double
// heterozygote (TC + CT) is ambiguous between ε1/ε3 and ε2/ε4 — we surface it
// as "ambiguous" rather than guessing.

export const APOE_TRAIT_KEY = 'apoe_genotype';

interface ApoeResolution {
  value: string;
  coaching: string;
}

export function resolveApoeDiplotype(
  rs429358: string | undefined,
  rs7412: string | undefined
): ApoeResolution | null {
  if (!rs429358 || !rs7412) return null;
  const a = rs429358; // sorted
  const b = rs7412; // sorted

  // Lookup table keyed by `${rs429358}|${rs7412}`. Both are alphabetically
  // sorted by the parser before reaching here.
  const key = `${a}|${b}`;
  const table: Record<string, ApoeResolution> = {
    // ε3/ε3 — most common, baseline cardiovascular profile.
    'TT|CC': {
      value: 'ε3/ε3',
      coaching:
        'Most common APOE genotype. Standard heart-healthy guidance applies — emphasize unsaturated fats (olive oil, nuts, fatty fish) and fiber from whole foods.',
    },
    // ε2 carriers — tend toward lower LDL, sometimes elevated triglycerides.
    'TT|CT': {
      value: 'ε2/ε3',
      coaching:
        'ε2 carrier. Often associated with lower LDL but somewhat higher triglycerides — prioritize omega-3-rich fish twice a week and limit refined sugars / alcohol.',
    },
    'TT|TT': {
      value: 'ε2/ε2',
      coaching:
        'ε2/ε2 (rare). Lipid profile can run unusual — get a fasting lipid panel periodically and lean heavily on whole foods, omega-3s, and minimal refined sugar.',
    },
    // ε4 carriers — saturated fat and alcohol hit lipids harder.
    'CT|CC': {
      value: 'ε3/ε4',
      coaching:
        'ε4 carrier. Saturated fat and alcohol affect your lipid profile more than average — favor olive oil, nuts, and fatty fish over butter/coconut oil; keep alcohol modest and prioritize aerobic conditioning.',
    },
    'CC|CC': {
      value: 'ε4/ε4',
      coaching:
        'ε4/ε4. Be deliberate about cardiovascular hygiene: Mediterranean-style fats (olive oil, nuts, fish), regular Z2 cardio, strong sleep, and minimal alcohol carry outsized return for you.',
    },
    // Ambiguous double-het — could be ε1/ε3 or ε2/ε4. We do not guess.
    'CT|CT': {
      value: 'ambiguous (ε1/ε3 or ε2/ε4)',
      coaching:
        'Genotype is ambiguous from these two SNPs alone — could be ε1/ε3 or ε2/ε4. A clinical APOE test would resolve it; until then no specific dietary guidance is implied.',
    },
  };

  return table[key] ?? null;
}
