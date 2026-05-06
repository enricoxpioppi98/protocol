import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import {
  discoverPatterns,
  PATTERN_KINDS,
  type CorrelationInputs,
  type DayRow,
  type PatternFinding,
} from '@/lib/coach/correlations';
import { computeCyclePhase } from '@/lib/cycle/phase';
import { getAdminClient } from '@/lib/supabase/admin';
import type { CycleEntry, CyclePhase } from '@/lib/types/models';

/**
 * GET/POST /api/coach/patterns/recompute
 *
 * Track 24 (v3): nightly correlation discovery. Same auth pattern as the other
 * crons (`Authorization: Bearer ${CRON_SECRET}`). For every user with at least
 * 30 days of biometrics:
 *
 *   1. Fetch last 90 days from `biometrics_daily_merged` (the priority-winning
 *      row per day, joined across Garmin/Whoop/Apple Watch/manual).
 *   2. Fetch last 90 days of diary entries → derive (a) dinner_time_minutes
 *      from the latest "Dinner" entry per day's `created_at`, (b)
 *      alcohol_logged from any food.name matching ALCOHOL_TERMS.
 *   3. Fetch last 90 days of glucose readings → 24h time-in-range %.
 *   4. Fetch all cycle_entries → recompute phase per-day with the existing
 *      `lib/cycle/phase.ts` helper.
 *   5. Build CorrelationInputs.per_day, call discoverPatterns().
 *   6. UPSERT findings on (user_id, pattern_kind). Then DELETE rows whose
 *      pattern_kind is in the candidate set but NOT in this run's findings —
 *      stale findings shouldn't linger after the relationship dissipates.
 *   7. Emit one coach_patterns.recompute.{success,error} audit row per user.
 *
 * Bounded by USER_LIMIT_PER_CALL — defensive even with one user. The per-user
 * budget is independent (each call scans up to 90d of inputs, ≪ 1s of work).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HISTORY_DAYS = 90;
const MIN_DAYS_OF_BIOMETRICS = 30;
const USER_LIMIT_PER_CALL = 50;

// Word-boundary match (case-insensitive) on food.name. We anchor with `\b` so
// "winegar" and "rumchata-flavoured cake" don't slip in via raw substring
// matches. List is intentionally narrow — false negatives are far cheaper
// than false positives here (the pattern is "alcohol → low HRV"; spurious
// alcohol days bias us toward null findings, which the gate filters out).
const ALCOHOL_TERMS = [
  'beer',
  'wine',
  'cocktail',
  'vodka',
  'whisky',
  'whiskey',
  'tequila',
  'rum',
  'gin',
  'champagne',
  'prosecco',
  'aperol',
  'spritz',
  'margarita',
  'mojito',
  'martini',
  'bourbon',
  'sake',
  'cider',
  'lager',
  'ale',
  'liqueur',
];
const ALCOHOL_RE = new RegExp(
  `\\b(${ALCOHOL_TERMS.join('|')})\\b`,
  'i',
);

interface UserResult {
  user_id: string;
  status: 'ok' | 'error' | 'skipped';
  findings_count: number;
  pruned_count: number;
  reason?: string;
  error?: string;
}

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === secret;
}

async function handle(req: Request): Promise<Response> {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const userIds = await listUsersWithEnoughBiometrics(admin);

  const results: UserResult[] = [];
  for (let i = 0; i < userIds.length && i < USER_LIMIT_PER_CALL; i++) {
    const userId = userIds[i]!;
    const started = Date.now();
    try {
      const { findings, pruned } = await recomputeUser(admin, userId);
      await logAudit({
        actor: userId,
        action: 'coach_patterns.recompute.success',
        target: 'coach_patterns',
        purpose: 'pattern_discovery',
        ts: new Date().toISOString(),
        status: 'ok',
        msElapsed: Date.now() - started,
        rowsAffected: findings.length,
        payload: { findings_count: findings.length, pruned_count: pruned },
      });
      results.push({
        user_id: userId,
        status: 'ok',
        findings_count: findings.length,
        pruned_count: pruned,
      });
    } catch (err) {
      const message = errorMessageOf(err);
      await logAudit({
        actor: userId,
        action: 'coach_patterns.recompute.error',
        target: 'coach_patterns',
        purpose: 'pattern_discovery',
        ts: new Date().toISOString(),
        status: 'error',
        msElapsed: Date.now() - started,
        rowsAffected: 0,
        errorMessage: message,
      });
      results.push({
        user_id: userId,
        status: 'error',
        findings_count: 0,
        pruned_count: 0,
        error: message,
      });
    }
  }

  return NextResponse.json({
    users_processed: results.length,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

// ============================================================================
// Per-user pipeline
// ============================================================================

interface RecomputeOutcome {
  findings: PatternFinding[];
  pruned: number;
}

async function recomputeUser(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<RecomputeOutcome> {
  const sinceDate = isoNDaysAgo(HISTORY_DAYS);
  const sinceISO = `${sinceDate}T00:00:00Z`;

  // All four reads in parallel — no DB joins needed; we reconcile in JS.
  const [bio, diary, glucose, cycles, profile] = await Promise.all([
    fetchBiometrics(admin, userId, sinceDate),
    fetchDiary(admin, userId, sinceDate),
    fetchGlucose(admin, userId, sinceISO),
    fetchCycleEntries(admin, userId),
    fetchProfile(admin, userId),
  ]);

  if (bio.length < MIN_DAYS_OF_BIOMETRICS) {
    // Not enough history — skip without writing or deleting (preserve any
    // findings from a previous run when biometrics were healthier).
    return { findings: [], pruned: 0 };
  }

  const perDay = buildPerDay(bio, diary, glucose, cycles, profile);
  const findings = discoverPatterns({ per_day: perDay });

  // Upsert this run's survivors; delete any prior surviving findings whose
  // pattern_kind is in the catalog but didn't make this run's cut.
  const survivingKinds = new Set(findings.map((f) => f.pattern_kind));
  const toPrune = (PATTERN_KINDS as readonly string[]).filter(
    (k) => !survivingKinds.has(k),
  );

  let pruned = 0;
  if (toPrune.length > 0) {
    const { count, error } = await admin
      .from('coach_patterns')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .in('pattern_kind', toPrune);
    if (error) {
      throw new Error(`coach_patterns delete: ${error.message}`);
    }
    pruned = count ?? 0;
  }

  if (findings.length > 0) {
    const upsertRows = findings.map((f) => ({
      user_id: userId,
      pattern_kind: f.pattern_kind,
      finding_text: f.finding_text,
      metric_a: f.metric_a,
      metric_b: f.metric_b,
      correlation: f.correlation,
      p_value: f.p_value,
      sample_size: f.sample_size,
      payload: f.payload,
      computed_at: new Date().toISOString(),
    }));
    const { error } = await admin
      .from('coach_patterns')
      .upsert(upsertRows, { onConflict: 'user_id,pattern_kind' });
    if (error) {
      throw new Error(`coach_patterns upsert: ${error.message}`);
    }
  }

  return { findings, pruned };
}

// ============================================================================
// Queries
// ============================================================================

interface BiometricsRow {
  date: string;
  hrv_ms: number | null;
  sleep_score: number | null;
  sleep_duration_minutes: number | null;
  resting_hr: number | null;
  training_load_acute: number | null;
  total_steps: number | null;
}

interface DiaryRow {
  user_id: string;
  date: string;
  meal_type: string;
  created_at: string;
  food: { name: string } | null;
  recipe: {
    name: string;
    ingredients: { food: { name: string } | null }[] | null;
  } | null;
}

interface GlucoseRow {
  recorded_at: string;
  mg_dl: number;
}

interface ProfileRow {
  gender: string | null;
}

async function listUsersWithEnoughBiometrics(
  admin: ReturnType<typeof getAdminClient>,
): Promise<string[]> {
  // Distinct user_ids that have at least one biometrics row inside the
  // window. We filter the >=30d threshold inside per-user processing rather
  // than via a SQL aggregate because Supabase's distinct/group helpers are
  // ergonomically painful from the JS client. With one user this is a
  // no-cost simplification.
  const sinceDate = isoNDaysAgo(HISTORY_DAYS);
  const { data, error } = await admin
    .from('biometrics_daily')
    .select('user_id')
    .gte('date', sinceDate)
    .limit(10000);
  if (error) throw new Error(`list users: ${error.message}`);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ user_id: string }>) {
    ids.add(row.user_id);
  }
  return Array.from(ids);
}

async function fetchBiometrics(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  sinceDate: string,
): Promise<BiometricsRow[]> {
  const { data, error } = await admin
    .from('biometrics_daily_merged')
    .select(
      'date, hrv_ms, sleep_score, sleep_duration_minutes, resting_hr, training_load_acute, total_steps',
    )
    .eq('user_id', userId)
    .gte('date', sinceDate)
    .order('date', { ascending: true });
  if (error) throw new Error(`biometrics fetch: ${error.message}`);
  return (data ?? []) as BiometricsRow[];
}

async function fetchDiary(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  sinceDate: string,
): Promise<DiaryRow[]> {
  // Join foods via food_id and recipes (with their ingredient foods) so we
  // can scan every food name attached to the day's entries — a recipe named
  // "Pizza Margherita" with a "house red wine" ingredient still surfaces.
  const { data, error } = await admin
    .from('diary_entries')
    .select(
      'user_id, date, meal_type, created_at, ' +
        'food:foods(name), ' +
        'recipe:recipes(name, ingredients:recipe_ingredients(food:foods(name)))',
    )
    .eq('user_id', userId)
    .gte('date', sinceDate)
    .is('deleted_at', null)
    .order('date', { ascending: true })
    .limit(5000);
  if (error) throw new Error(`diary fetch: ${error.message}`);
  return (data ?? []) as unknown as DiaryRow[];
}

async function fetchGlucose(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  sinceISO: string,
): Promise<GlucoseRow[]> {
  const { data, error } = await admin
    .from('glucose_readings')
    .select('recorded_at, mg_dl')
    .eq('user_id', userId)
    .gte('recorded_at', sinceISO)
    .order('recorded_at', { ascending: true })
    .limit(20000);
  if (error) throw new Error(`glucose fetch: ${error.message}`);
  return (data ?? []) as GlucoseRow[];
}

async function fetchCycleEntries(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<CycleEntry[]> {
  const { data, error } = await admin
    .from('cycle_entries')
    .select('id, user_id, start_date, duration_days, notes, created_at, updated_at')
    .eq('user_id', userId)
    .order('start_date', { ascending: true });
  if (error) throw new Error(`cycle fetch: ${error.message}`);
  return (data ?? []) as CycleEntry[];
}

async function fetchProfile(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from('user_profile')
    .select('gender')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // Non-fatal — cycle pattern just won't run.
    console.warn('[patterns/recompute] profile fetch warn', error.message);
    return null;
  }
  return (data as ProfileRow | null) ?? null;
}

// ============================================================================
// Day-row assembly
// ============================================================================

function buildPerDay(
  bio: BiometricsRow[],
  diary: DiaryRow[],
  glucose: GlucoseRow[],
  cycles: CycleEntry[],
  profile: ProfileRow | null,
): Record<string, DayRow> {
  const perDay: Record<string, DayRow> = {};

  // 1) Seed from biometrics — the anchor for the whole window.
  for (const row of bio) {
    perDay[row.date] = {
      hrv_ms: row.hrv_ms,
      sleep_score: row.sleep_score,
      sleep_duration_minutes: row.sleep_duration_minutes,
      resting_hr: row.resting_hr,
      training_load_acute: row.training_load_acute,
      total_steps: row.total_steps,
    };
  }

  // 2) Diary → dinner_time_minutes + alcohol_logged.
  const diaryByDay = groupByDate(diary, (r) => r.date);
  for (const [date, rows] of diaryByDay) {
    const day = perDay[date] ?? (perDay[date] = {});
    let latestDinnerCreatedAt: number | null = null;
    let alcohol = false;

    for (const r of rows) {
      // Dinner timestamp — prefer the LAST-logged Dinner entry of the day so
      // a snack logged at 23:00 doesn't masquerade as dinner. We use
      // created_at (when the entry was logged) as the only timestamp the
      // schema gives us; this is a documented approximation — users who log
      // hours after eating will pull the signal toward the wrong timestamp.
      if (r.meal_type === 'Dinner') {
        const t = Date.parse(r.created_at);
        if (Number.isFinite(t) && (latestDinnerCreatedAt === null || t > latestDinnerCreatedAt)) {
          latestDinnerCreatedAt = t;
        }
      }

      // Alcohol — scan the food name on the entry plus any ingredient food
      // names on its recipe. We don't bother with the recipe NAME itself
      // (recipes are user-named and noisy), only the underlying foods.
      const names = collectFoodNames(r);
      if (!alcohol && names.some(matchesAlcoholTerm)) alcohol = true;
    }

    if (latestDinnerCreatedAt !== null) {
      day.dinner_time_minutes = minutesSinceMidnightUTC(latestDinnerCreatedAt);
    }
    day.alcohol_logged = alcohol;
  }

  // 3) Glucose → 24h time-in-range (70-180 mg/dL is the common consumer-CGM
  //    target band; we use it because the schema has no per-user goal yet).
  const glucoseByDay = groupByDate(glucose, (r) =>
    isoDateUTC(new Date(r.recorded_at)),
  );
  for (const [date, rows] of glucoseByDay) {
    if (rows.length < 4) continue; // too few readings to call a daily TIR
    const inRange = rows.filter((r) => r.mg_dl >= 70 && r.mg_dl <= 180).length;
    const tir = (100 * inRange) / rows.length;
    const day = perDay[date] ?? (perDay[date] = {});
    day.glucose_tir_pct = tir;
  }

  // 4) Cycle phase per day. We only attach phases for users whose profile
  //    gender is female/nonbinary AND who have at least one cycle_entry. The
  //    pattern itself further requires >=3 obs in two phases to fire.
  const gender = profile?.gender;
  const cycleEligible =
    (gender === 'female' || gender === 'nonbinary') && cycles.length > 0;
  if (cycleEligible) {
    for (const date of Object.keys(perDay)) {
      const phase = phaseForDate(cycles, date);
      if (phase && phase !== 'unknown') {
        perDay[date]!.cycle_phase = phase;
      }
    }
  }

  return perDay;
}

function phaseForDate(
  entries: CycleEntry[],
  yyyymmdd: string,
): CyclePhase | null {
  const d = new Date(`${yyyymmdd}T12:00:00Z`); // mid-day to dodge tz edge cases
  if (Number.isNaN(d.getTime())) return null;
  return computeCyclePhase(entries, d).phase;
}

// ============================================================================
// Helpers
// ============================================================================

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function minutesSinceMidnightUTC(epochMs: number): number {
  const d = new Date(epochMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function groupByDate<T>(
  rows: T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = out.get(k);
    if (arr) arr.push(r);
    else out.set(k, [r]);
  }
  return out;
}

function collectFoodNames(row: DiaryRow): string[] {
  const names: string[] = [];
  if (row.food?.name) names.push(row.food.name);
  if (row.recipe?.ingredients) {
    for (const ing of row.recipe.ingredients) {
      if (ing.food?.name) names.push(ing.food.name);
    }
  }
  return names;
}

function matchesAlcoholTerm(name: string): boolean {
  return ALCOHOL_RE.test(name);
}

function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}
