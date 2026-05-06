import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/demo/seed
 *
 * Track 23 (v3) — one-click "seed demo data" route.
 *
 * Populates the calling user's account with ~90 days of biometrics, two
 * weeks of daily briefings, a coherent ~20-message chat thread, a realistic
 * genome traits dict, two blood panels, ~30 glucose readings, and ~28
 * cycle entries (only when the user_profile.gender is 'female'). Idempotent
 * via upserts on the natural keys — re-calling the route refreshes the
 * windows, never doubles them.
 *
 * The data is deliberately *not* random gibberish. A demo viewer reading
 * the chat history finds a hip-pain thread (so the recall demo lights up
 * on the seed phrase "hip pain"), a Saturday-night HRV dip, a 28-day HRV
 * upward trend, and a workout pattern that matches the weekly_schedule.
 *
 * Why server-side TypeScript instead of `seed-demo.sql`:
 *   - The .sql file requires the user to manually substitute their UUID,
 *     which kills the "5 second from /settings to populated dashboard"
 *     promise. The TS route reads the auth session and seeds for that user.
 *   - We can use `getAdminClient()` to bypass RLS where the schema demands
 *     it (e.g. blood_marker_readings has no direct user_id column), without
 *     leaking the service-role key client-side.
 *
 * Returns `{ ok: true, seeded: { biometrics, briefings, chat, ... } }`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============================================================
// Tunables — tweak here, not at the call sites
// ============================================================

const BIOMETRICS_DAYS = 90;
const BRIEFING_DAYS = 14;
// Chat turns are hard-coded inline below (10 user + 10 assistant = 20 messages)
// rather than parameterized — the conversation has narrative beats that don't
// scale uniformly, so a single tunable would be misleading.
const GLUCOSE_READINGS_DAYS = 14; // ~2 readings/day = ~30
const CYCLE_ENTRIES_COUNT = 4; // 4 cycles * ~28 days ≈ ~28d coverage; set in days

// ============================================================
// Deterministic pseudo-random (so re-seeds produce the same numbers)
// ============================================================

/**
 * Hash a string to a 32-bit unsigned int. Used to produce a per-user RNG
 * seed so two demo users get different numbers but the same user always
 * sees the same data. cyrb53 is a tiny, well-distributed string hasher.
 */
function hashSeed(s: string): number {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

/** mulberry32 — small deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ============================================================
// Date helpers
// ============================================================

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// ============================================================
// Biometrics — 90 days
// ============================================================

interface BiometricRow {
  user_id: string;
  date: string;
  source: 'garmin';
  sleep_score: number;
  sleep_duration_minutes: number;
  hrv_ms: number;
  resting_hr: number;
  stress_avg: number;
  training_load_acute: number;
  training_load_chronic: number;
  total_steps: number;
  active_minutes: number;
  vigorous_minutes: number;
  moderate_minutes: number;
  total_kcal_burned: number;
  active_kcal_burned: number;
  vo2max: number;
  max_hr: number;
  min_hr: number;
  deep_sleep_minutes: number;
  rem_sleep_minutes: number;
  light_sleep_minutes: number;
  awake_sleep_minutes: number;
  sleep_efficiency: number;
  body_battery_high: number;
  body_battery_low: number;
  body_battery_charged: number;
  body_battery_drained: number;
  floors_climbed: number;
  fetched_at: string;
  raw: null;
}

/**
 * Generate 90 days of biometric rows with two macro-patterns layered on a
 * per-day jitter:
 *   1. A 28-day gradual HRV improvement (training adaptation): +6ms across
 *      the window, so day-90-old reads ~46ms and today reads ~52ms.
 *   2. A weekend-party pattern: Saturday+Sunday mornings show an HRV dip
 *      (~-8ms) and a sleep_score dip (~-12) plus a small RHR bump (+3bpm).
 *      The viewer can spot the weekly rhythm just by squinting at the chart.
 *
 * All values stay inside coachable ranges (HRV 38-62ms, sleep_score 55-92,
 * RHR 48-58bpm). `source` is hard-coded to 'garmin' so the merged view picks
 * the row deterministically (garmin is highest-priority by default).
 */
function generateBiometrics(userId: string, rng: () => number): BiometricRow[] {
  const rows: BiometricRow[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Baselines — these are population-norm-ish endurance-athlete numbers.
  const baseHRV = 46;
  const baseRHR = 53;
  const baseSleepScore = 78;

  // Linear training-adaptation lift: across 90 days, HRV climbs ~6ms.
  function adaptationLift(daysOld: number): number {
    const progress = (BIOMETRICS_DAYS - daysOld) / BIOMETRICS_DAYS;
    return progress * 6;
  }

  for (let i = BIOMETRICS_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    const isWeekendMorning = dow === 0 || dow === 6;

    // Per-day jitter — narrow so the trend reads cleanly.
    const hrvJitter = (rng() - 0.5) * 6;
    const sleepJitter = (rng() - 0.5) * 8;
    const rhrJitter = (rng() - 0.5) * 2;

    // Weekend penalty — visible bump on Sat/Sun
    const weekendHrv = isWeekendMorning ? -8 : 0;
    const weekendSleep = isWeekendMorning ? -12 : 0;
    const weekendRhr = isWeekendMorning ? 3 : 0;

    const hrv = clamp(
      Math.round(baseHRV + adaptationLift(i) + hrvJitter + weekendHrv),
      38,
      62
    );
    const sleepScore = clamp(
      Math.round(baseSleepScore + sleepJitter + weekendSleep),
      55,
      92
    );
    const rhr = clamp(Math.round(baseRHR + rhrJitter + weekendRhr), 48, 58);

    const sleepDuration = clamp(
      Math.round(420 + sleepJitter * 4 - (isWeekendMorning ? 30 : 0)),
      330,
      510
    );
    const deepSleep = clamp(Math.round(70 + (rng() - 0.5) * 50), 60, 120);
    const remSleep = clamp(Math.round(85 + (rng() - 0.5) * 40), 60, 130);
    const awakeSleep = clamp(Math.round(8 + rng() * 18), 5, 35);
    const lightSleep = Math.max(0, sleepDuration - deepSleep - remSleep - awakeSleep);
    const sleepEfficiency = clamp(
      Math.round(((sleepDuration - awakeSleep) / sleepDuration) * 100 * 10) / 10,
      78,
      98
    );

    // Steps pattern: lift days are 6-8k, run days 9-12k, long run 13-15k,
    // rest days 4-5k. Approximated from day-of-week.
    let steps: number;
    let activeMinutes: number;
    let vigorousMinutes: number;
    if (dow === 6) {
      // Sat — long run
      steps = randInt(rng, 13000, 15000);
      activeMinutes = randInt(rng, 80, 110);
      vigorousMinutes = randInt(rng, 35, 55);
    } else if (dow === 0) {
      // Sun — rest, low steps
      steps = randInt(rng, 4000, 5500);
      activeMinutes = randInt(rng, 25, 45);
      vigorousMinutes = randInt(rng, 0, 8);
    } else if (dow === 2 || dow === 4) {
      // Tue/Thu — run
      steps = randInt(rng, 9000, 12000);
      activeMinutes = randInt(rng, 55, 80);
      vigorousMinutes = randInt(rng, 25, 45);
    } else {
      // Mon/Wed/Fri — lift
      steps = randInt(rng, 6000, 8500);
      activeMinutes = randInt(rng, 45, 65);
      vigorousMinutes = randInt(rng, 12, 25);
    }

    rows.push({
      user_id: userId,
      date: ymd(d),
      source: 'garmin',
      sleep_score: sleepScore,
      sleep_duration_minutes: sleepDuration,
      hrv_ms: hrv,
      resting_hr: rhr,
      stress_avg: clamp(Math.round(28 + rng() * 25 + (isWeekendMorning ? 8 : 0)), 18, 65),
      training_load_acute: randInt(rng, 380, 470),
      training_load_chronic: randInt(rng, 410, 440),
      total_steps: steps,
      active_minutes: activeMinutes,
      vigorous_minutes: vigorousMinutes,
      moderate_minutes: Math.max(0, activeMinutes - vigorousMinutes),
      total_kcal_burned: randInt(rng, 2400, 3200),
      active_kcal_burned: randInt(rng, 400, 1100),
      vo2max: 52 + Math.round(((BIOMETRICS_DAYS - i) / BIOMETRICS_DAYS) * 3),
      max_hr: randInt(rng, 168, 188),
      min_hr: rhr - randInt(rng, 2, 5),
      deep_sleep_minutes: deepSleep,
      rem_sleep_minutes: remSleep,
      light_sleep_minutes: lightSleep,
      awake_sleep_minutes: awakeSleep,
      sleep_efficiency: sleepEfficiency,
      body_battery_high: clamp(Math.round(72 + sleepJitter), 55, 95),
      body_battery_low: clamp(Math.round(18 + (rng() - 0.5) * 10), 8, 30),
      body_battery_charged: randInt(rng, 50, 75),
      body_battery_drained: randInt(rng, 55, 80),
      floors_climbed: randInt(rng, 8, 28),
      fetched_at: new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString(),
      raw: null,
    });
  }
  return rows;
}

// ============================================================
// Briefings — 14 days of plans that read the day's biometrics
// ============================================================

interface BriefingRow {
  user_id: string;
  date: string;
  meals: unknown;
  workout: unknown;
  recovery_note: string;
  model: string;
  prompt_cache_hit: boolean;
  generated_at: string;
}

/**
 * Workout pattern by day-of-week, mirroring the seed-demo.sql weekly_schedule:
 *   Mon/Wed/Fri  → lift
 *   Tue/Thu      → run (Z2)
 *   Sat          → run (long)
 *   Sun          → rest / mobility
 * Each block is a small JSON the BriefingCard renders without tweaks.
 */
function workoutForDay(dow: number, biometrics: BiometricRow): unknown {
  const lowRecovery = biometrics.sleep_score < 65 || biometrics.hrv_ms < 42;

  if (dow === 1 || dow === 3 || dow === 5) {
    // Lift day
    if (lowRecovery) {
      return {
        name: 'Reduced lift — drop top set',
        duration_minutes: 45,
        blocks: [
          { name: 'Mobility flow', reps: '5 min', intensity: 'easy' },
          { name: 'Goblet squat', sets: 3, reps: '8', intensity: 'RPE 6', notes: 'Skip the barbell today.' },
          { name: 'DB bench press', sets: 3, reps: '8', intensity: 'RPE 7' },
          { name: 'Single-arm row', sets: 3, reps: '10/side', intensity: 'RPE 7' },
          { name: 'Plank', sets: 3, reps: '40s' },
        ],
      };
    }
    return {
      name: 'Push/pull lift',
      duration_minutes: 55,
      blocks: [
        { name: 'Warm-up', reps: '6 min', intensity: 'mobility' },
        { name: 'Back squat', sets: 4, reps: '5', intensity: '80% 1RM' },
        { name: 'Bench press', sets: 4, reps: '5', intensity: '80% 1RM' },
        { name: 'Pull-ups', sets: 3, reps: 'AMRAP-1' },
        { name: 'Walking lunge', sets: 3, reps: '20 steps' },
      ],
    };
  }

  if (dow === 2 || dow === 4) {
    // Easy/tempo run
    return {
      name: lowRecovery ? 'Easy 30min Z1-Z2' : 'Tempo 5×4min',
      duration_minutes: lowRecovery ? 30 : 45,
      blocks: lowRecovery
        ? [
            { name: 'Warm-up jog', reps: '8 min', intensity: 'Z1' },
            { name: 'Easy continuous', reps: '18 min', intensity: 'Z1-Z2 (HR < 142)' },
            { name: 'Cool-down', reps: '4 min', intensity: 'Z1' },
          ]
        : [
            { name: 'Warm-up', reps: '10 min', intensity: 'Z1-Z2' },
            { name: 'Tempo intervals', sets: 5, reps: '4 min', intensity: 'threshold (HR 160-168)' },
            { name: 'Recovery jog', reps: '2 min between sets', intensity: 'Z1' },
            { name: 'Cool-down', reps: '8 min', intensity: 'Z1' },
          ],
    };
  }

  if (dow === 6) {
    // Long run Saturday
    return {
      name: 'Long run — 75min Z2',
      duration_minutes: 75,
      blocks: [
        { name: 'Warm-up jog', reps: '12 min', intensity: 'Z1' },
        { name: 'Steady Z2', reps: '55 min', intensity: 'Z2 (HR 138-148)' },
        { name: 'Cool-down', reps: '8 min', intensity: 'Z1' },
      ],
    };
  }

  // Sunday — rest / mobility
  return {
    name: 'Mobility + walk',
    duration_minutes: 35,
    blocks: [
      { name: 'Hip mobility flow', reps: '8 min', intensity: 'easy' },
      { name: 'Outdoor walk', reps: '20 min', intensity: 'Z1' },
      { name: 'Foam roll', reps: '5 min' },
    ],
  };
}

function mealsForDay(dow: number): unknown {
  // Three rotating meal templates. Each returns a Briefing.meals[] payload.
  const templates = [
    [
      {
        slot: 'breakfast',
        name: 'Greek yogurt + oats + berries',
        items: [
          { food: '0% Greek yogurt', grams: 250 },
          { food: 'Rolled oats', grams: 60 },
          { food: 'Mixed berries', grams: 100 },
        ],
        macros: { kcal: 480, p: 35, c: 80, f: 7 },
      },
      {
        slot: 'lunch',
        name: 'Chicken rice bowl',
        items: [
          { food: 'Chicken breast', grams: 200 },
          { food: 'White rice (cooked)', grams: 250 },
          { food: 'Avocado', grams: 50 },
        ],
        macros: { kcal: 690, p: 60, c: 70, f: 14 },
      },
      {
        slot: 'dinner',
        name: 'Salmon + roast potato + broccoli',
        items: [
          { food: 'Salmon', grams: 180 },
          { food: 'Roasted potato', grams: 220 },
          { food: 'Broccoli', grams: 150 },
        ],
        macros: { kcal: 720, p: 48, c: 55, f: 28 },
      },
    ],
    [
      {
        slot: 'breakfast',
        name: 'Eggs + sourdough + spinach',
        items: [
          { food: 'Whole egg', grams: 150 },
          { food: 'Sourdough toast', grams: 80 },
          { food: 'Spinach', grams: 60 },
        ],
        macros: { kcal: 460, p: 28, c: 42, f: 18 },
      },
      {
        slot: 'lunch',
        name: 'Turkey & quinoa bowl',
        items: [
          { food: 'Ground turkey', grams: 180 },
          { food: 'Quinoa (cooked)', grams: 220 },
          { food: 'Bell pepper', grams: 100 },
        ],
        macros: { kcal: 640, p: 52, c: 62, f: 16 },
      },
      {
        slot: 'dinner',
        name: 'Beef stir-fry + rice',
        items: [
          { food: 'Lean beef', grams: 200 },
          { food: 'White rice (cooked)', grams: 220 },
          { food: 'Mixed vegetables', grams: 200 },
        ],
        macros: { kcal: 720, p: 56, c: 68, f: 18 },
      },
    ],
    [
      {
        slot: 'breakfast',
        name: 'Protein smoothie + banana',
        items: [
          { food: 'Whey protein', grams: 35 },
          { food: 'Banana', grams: 120 },
          { food: 'Almond butter', grams: 20 },
          { food: 'Oat milk', grams: 250 },
        ],
        macros: { kcal: 460, p: 38, c: 60, f: 12 },
      },
      {
        slot: 'lunch',
        name: 'Tuna pasta salad',
        items: [
          { food: 'Tuna (canned)', grams: 150 },
          { food: 'Whole-wheat pasta (cooked)', grams: 200 },
          { food: 'Olive oil', grams: 15 },
        ],
        macros: { kcal: 620, p: 48, c: 70, f: 16 },
      },
      {
        slot: 'dinner',
        name: 'Lentil curry + brown rice',
        items: [
          { food: 'Red lentils (cooked)', grams: 250 },
          { food: 'Brown rice (cooked)', grams: 200 },
          { food: 'Coconut milk', grams: 80 },
        ],
        macros: { kcal: 690, p: 32, c: 95, f: 18 },
      },
    ],
  ];
  return templates[dow % templates.length];
}

function recoveryNoteForDay(b: BiometricRow, dow: number): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = dayNames[dow];

  if (b.sleep_score < 65 && b.hrv_ms < 42) {
    return `Sleep was light (score ${b.sleep_score}) and HRV is below baseline at ${b.hrv_ms}ms — Z2 day, drop the top lift sets, push the hard work to ${dayName === 'Mon' ? 'Tuesday' : 'tomorrow'}.`;
  }
  if (b.hrv_ms >= 50 && b.sleep_score >= 80) {
    return `HRV is up (${b.hrv_ms}ms) and you slept ${Math.round(b.sleep_duration_minutes / 60 * 10) / 10}h — green light to push the prescribed intensity. Hydrate before the warm-up.`;
  }
  if (dow === 0 || dow === 6) {
    return `Weekend — HRV at ${b.hrv_ms}ms, sleep ${b.sleep_score}. Keep aerobic, no spiked intensity. Get 8k+ steps and protein with every meal.`;
  }
  return `Mixed signals — HRV ${b.hrv_ms}ms, sleep ${b.sleep_score}. Run the full plan but treat RPE 8 as the ceiling, not the target.`;
}

function generateBriefings(userId: string, biometrics: BiometricRow[]): BriefingRow[] {
  // Pick the latest BRIEFING_DAYS rows; biometrics is oldest-first.
  const recent = biometrics.slice(-BRIEFING_DAYS);
  return recent.map((b) => {
    const d = new Date(b.date + 'T00:00:00');
    const dow = d.getDay();
    return {
      user_id: userId,
      date: b.date,
      meals: mealsForDay(dow),
      workout: workoutForDay(dow, b),
      recovery_note: recoveryNoteForDay(b, dow),
      model: 'claude-sonnet-4-6',
      prompt_cache_hit: true,
      generated_at: new Date(d.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    };
  });
}

// ============================================================
// Chat — 20 messages with a coherent hip-pain thread
// ============================================================

interface ChatRow {
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: unknown[];
  created_at: string;
}

/**
 * Generate a 20-message thread that reads as a real coaching conversation.
 * The arc:
 *   1. User reports right-hip pain after Saturday's long run.
 *   2. Coach swaps barbell back-squat → goblet squat for Monday's lift.
 *   3. User asks why training feels harder this week (HRV drop).
 *   4. Coach explains weekend dip + suggests Z1 instead of tempo.
 *   5. User asks about a dietary swap (oats → Greek yogurt).
 *   6. Coach affirms and notes protein bump.
 *   7. User reports hip is improving by Wednesday.
 *   8. Coach adds back the squat with reduced load.
 *   9. User asks about caffeine timing.
 *  10. Coach references their CYP1A2 slow-metabolizer flag.
 *
 * The seed-phrase "hip pain" appears in the very first user turn so the
 * recall demo (Track 12 memory retrieval) has an obvious target.
 */
function generateChatRows(userId: string): ChatRow[] {
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [
    {
      role: 'user',
      content:
        "I've got some hip pain on the right side after Saturday's long run. Not sharp, more of a deep ache when I sit. Worth changing today's lift?",
    },
    {
      role: 'assistant',
      content:
        "Yes — let's keep the volume but drop the load and pattern that loads the hip eccentrically. I'll swap back-squat for goblet squat (3×8 @ RPE 6), keep the bench, and skip walking lunge. Gentle pigeon stretch + 90/90s after the warm-up. If the ache turns sharp during any movement, stop and message me.",
    },
    {
      role: 'user',
      content:
        'Why does training feel harder this week? My HRV looks lower in the dashboard.',
    },
    {
      role: 'assistant',
      content:
        "Your HRV is down ~6ms vs your 30-day baseline (45 → 39ms today), and the dip lined up with two short-sleep nights Fri-Sat. That's the body protecting itself. Keep aerobic this week — Z1-Z2 intervals instead of threshold — and HRV usually recovers within 5-7 days. The training is the same; the ceiling just moved.",
    },
    {
      role: 'user',
      content:
        "Can I swap the breakfast oats for Greek yogurt? I'm getting tired of oats and I want more protein in the morning.",
    },
    {
      role: 'assistant',
      content:
        "Good swap. 250g of 0% Greek yogurt + the same 100g of berries gets you ~28g protein for breakfast (vs 13g with oats), which puts you closer to the 1g/lb target across the day. Same kcal envelope. I'll fold this into tomorrow's briefing.",
    },
    {
      role: 'user',
      content: 'Quick update — the hip is feeling 70% better today. Can I add the squat back?',
    },
    {
      role: 'assistant',
      content:
        "Glad to hear it. Yes — back-squat at 70% 1RM for 3×5 (instead of 4×5 @ 80%). That's enough load to keep the pattern without testing the joint. If you make it through warm-up sets pain-free, do all working sets. If anything pinches, stop and we'll regroup.",
    },
    {
      role: 'user',
      content:
        "Is morning espresso fine on my hard run days? I noticed the briefing didn't mention caffeine.",
    },
    {
      role: 'assistant',
      content:
        "On your genome panel you're a CYP1A2 slow metabolizer (AC genotype) — caffeine clears slowly, so a morning espresso (≤1-2 cups) is fine pre-run, but cap it before 10am on training days. Afternoon doses will linger and chip away at sleep, which is the actual lever for HRV recovery this block.",
    },
    {
      role: 'user',
      content: "Why is the dinner protein so high tonight? I don't usually eat 50g+ at dinner.",
    },
    {
      role: 'assistant',
      content:
        "Two reasons: today is a lift day (your muscle protein synthesis window is biggest in the 24h after a strength session), and your morning + lunch came in 12g short of the 1g/lb target. The dinner load reaches the daily total without needing to over-pack the breakfast you already swapped.",
    },
    {
      role: 'user',
      content:
        'Do I need to drop the long run this Saturday given the hip thing? I was planning 90min.',
    },
    {
      role: 'assistant',
      content:
        "Cap it at 70min, not 90, and keep it pure Z2 (HR < 148). The hip stress comes more from late-run form breakdown than total minutes — when you go past ~75min you start guarding. We'll rebuild to 90min next weekend if Saturday is symptom-free.",
    },
    {
      role: 'user',
      content: 'Quick one — should I be worried about my LDL on the latest panel? It came back at 110.',
    },
    {
      role: 'assistant',
      content:
        "110 mg/dL is in the optimal range for your training profile — the panel also showed apoB 88, hsCRP 0.6, hbA1c 5.2, all clean. APOE 3/3 means no genetic flag for elevated LDL responsiveness. Keep the omega-3, oats, and Z2 volume; recheck in a quarter.",
    },
    {
      role: 'user',
      content: 'Friday push or pull tomorrow? I forgot what we agreed on last week.',
    },
    {
      role: 'assistant',
      content:
        "Friday is the second push day of the week (Mon was push too, Wed was pull) — bench press + overhead-adjacent. Same template as Monday but rotate the secondary: incline DB press instead of flat bench accessory. Briefing will have the full block at 6am.",
    },
    {
      role: 'user',
      content: 'How am I trending vs my goal?',
    },
    {
      role: 'assistant',
      content:
        "Your sub-20 5K target — VO2 max is up 3 points (52 → 55) over the 90-day window, resting HR dropped 2bpm, and you've held 6 quality sessions/week with one true rest day. You're pacing well; the next test should be a tempo 5K time-trial in 2 weeks, ideally a fresh-legs Sunday.",
    },
  ];

  // Stamp timestamps in chronological order, ending at "now". Each turn ~30
  // minutes apart so the slide-over reads as a single sustained chat.
  const now = Date.now();
  const halfHour = 30 * 60 * 1000;
  return turns.map((t, i) => ({
    user_id: userId,
    role: t.role,
    content: t.content,
    tools: [],
    created_at: new Date(now - (turns.length - i) * halfHour).toISOString(),
  }));
}

// ============================================================
// Genome traits — coherent endurance-athlete-friendly panel
// ============================================================

function genomeTraits(): Record<string, unknown> {
  return {
    caffeine_metabolism: {
      value: 'slow metabolizer',
      coaching:
        'Slow caffeine metabolizer. Cap caffeine at 1-2 cups before noon; later doses will linger and chip away at sleep quality more than for fast metabolizers.',
      rsid: 'rs762551',
      gene: 'CYP1A2',
      genotype: 'AC',
    },
    muscle_fiber_bias: {
      value: 'mixed power/endurance',
      coaching:
        'Mixed fiber profile — flexible across modalities. A balanced program (heavy lifts + Z2 + occasional VO2 work) tends to work; you do not need to specialize.',
      rsid: 'rs1815739',
      gene: 'ACTN3',
      genotype: 'CT',
    },
    dopamine_clearance: {
      value: 'slow clearance ("worrier")',
      coaching:
        'Met/Met COMT — dopamine clears slowly. You may focus deeply but feel pre-race nerves more sharply; lean on routines and pre-event walk-throughs to channel the activation.',
      rsid: 'rs4680',
      gene: 'COMT',
      genotype: 'AA',
    },
    lactose_tolerance: {
      value: 'lactase-persistent',
      coaching:
        'Lactase-persistent — dairy is well-tolerated as a protein source. Greek yogurt and milk-based shakes are efficient post-workout options without GI tradeoffs.',
      rsid: 'rs4988235',
      gene: 'MCM6',
      genotype: 'AA',
    },
    apoe_genotype: {
      value: 'ε3/ε3',
      coaching:
        "APOE ε3/ε3 — the typical lipid-handling profile. No special dietary fat flag; standard balanced fats with omega-3 emphasis fits.",
      rsid: 'rs429358+rs7412',
      gene: 'APOE',
      genotype: 'TT/CC',
    },
    vo2max_trainability: {
      value: 'strong VO2 trainability',
      coaching:
        'Strong VO2 trainability. Structured Z2 + 1-2x weekly VO2-max intervals will reliably lift aerobic capacity; you tend to see measurable gains within 6-8 weeks.',
      rsid: 'rs8192678',
      gene: 'PPARGC1A',
      genotype: 'GG',
    },
  };
}

// ============================================================
// Blood panels (1-2 panels, optimal markers)
// ============================================================

interface BloodPanelInsert {
  user_id: string;
  panel_date: string;
  lab: string;
  notes: string;
  source: 'manual';
}

interface BloodMarkerInsert {
  panel_id: string;
  marker: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  flag: 'low' | 'normal' | 'high';
}

const PANEL_MARKERS: Array<Omit<BloodMarkerInsert, 'panel_id'>> = [
  { marker: 'ldl', value: 110, unit: 'mg/dL', reference_low: 0, reference_high: 130, flag: 'normal' },
  { marker: 'hdl', value: 55, unit: 'mg/dL', reference_low: 40, reference_high: 100, flag: 'normal' },
  { marker: 'tc', value: 178, unit: 'mg/dL', reference_low: 100, reference_high: 200, flag: 'normal' },
  { marker: 'apoB', value: 88, unit: 'mg/dL', reference_low: 0, reference_high: 100, flag: 'normal' },
  { marker: 'hsCRP', value: 0.6, unit: 'mg/L', reference_low: 0, reference_high: 1.0, flag: 'normal' },
  { marker: 'hbA1c', value: 5.2, unit: '%', reference_low: 4.0, reference_high: 5.7, flag: 'normal' },
  { marker: 'glucose_fasting', value: 86, unit: 'mg/dL', reference_low: 70, reference_high: 99, flag: 'normal' },
  { marker: 'triglycerides', value: 78, unit: 'mg/dL', reference_low: 0, reference_high: 150, flag: 'normal' },
  { marker: 'vitamin_d', value: 42, unit: 'ng/mL', reference_low: 30, reference_high: 100, flag: 'normal' },
  { marker: 'ferritin', value: 95, unit: 'ng/mL', reference_low: 30, reference_high: 300, flag: 'normal' },
];

// ============================================================
// Glucose readings — 14 days × ~2 readings/day
// ============================================================

interface GlucoseRow {
  user_id: string;
  recorded_at: string;
  mg_dl: number;
  context: string;
  source: 'manual';
  notes: string;
}

function generateGlucose(userId: string, rng: () => number): GlucoseRow[] {
  const rows: GlucoseRow[] = [];
  for (let i = GLUCOSE_READINGS_DAYS - 1; i >= 0; i--) {
    const d = daysAgo(i);
    // Fasting reading at 7am
    const fasting = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    rows.push({
      user_id: userId,
      recorded_at: fasting.toISOString(),
      mg_dl: clamp(Math.round(82 + (rng() - 0.5) * 14), 70, 96),
      context: 'fasting',
      source: 'manual',
      notes: '',
    });
    // Post-lunch spike at 1:30pm — sometimes a real bump
    const postMeal = new Date(d.getTime() + 13.5 * 60 * 60 * 1000);
    const spike = i % 4 === 0 ? randInt(rng, 140, 155) : randInt(rng, 95, 125);
    rows.push({
      user_id: userId,
      recorded_at: postMeal.toISOString(),
      mg_dl: spike,
      context: 'post_meal',
      source: 'manual',
      notes: spike > 140 ? 'rice bowl + larger portion' : '',
    });
  }
  return rows;
}

// ============================================================
// Cycle entries — 4 cycles × 28 days
// ============================================================

interface CycleRow {
  user_id: string;
  start_date: string;
  duration_days: number;
  notes: string;
}

function generateCycles(userId: string): CycleRow[] {
  const rows: CycleRow[] = [];
  for (let i = 0; i < CYCLE_ENTRIES_COUNT; i++) {
    const d = daysAgo(28 * (i + 1) - 4); // each cycle ~28d ago, offset 4
    rows.push({
      user_id: userId,
      start_date: ymd(d),
      duration_days: 5,
      notes: '',
    });
  }
  return rows;
}

// ============================================================
// Route handler
// ============================================================

interface SeedResult {
  ok: boolean;
  seeded: {
    biometrics: number;
    briefings: number;
    chat: number;
    blood_panels: number;
    blood_markers: number;
    glucose_readings: number;
    cycle_entries: number;
    genome_traits: number;
  };
}

export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const userId = user.id;
  const rng = mulberry32(hashSeed(userId));
  const admin = getAdminClient();

  // -------- biometrics --------
  const biometricRows = generateBiometrics(userId, rng);
  // The (user_id, date, source) PK from migration 013 means we can just upsert
  // and re-runs will refresh in place rather than throwing on conflict.
  const { error: bioErr } = await admin
    .from('biometrics_daily')
    .upsert(biometricRows, { onConflict: 'user_id,date,source' });
  if (bioErr) {
    console.error('[demo/seed] biometrics upsert failed', bioErr);
    return NextResponse.json(
      { error: 'failed to seed biometrics', detail: bioErr.message },
      { status: 500 }
    );
  }

  // -------- briefings --------
  const briefingRows = generateBriefings(userId, biometricRows);
  const { error: briefErr } = await admin
    .from('daily_briefing')
    .upsert(briefingRows, { onConflict: 'user_id,date' });
  if (briefErr) {
    console.error('[demo/seed] briefing upsert failed', briefErr);
    return NextResponse.json(
      { error: 'failed to seed briefings', detail: briefErr.message },
      { status: 500 }
    );
  }

  // -------- chat --------
  // chat_messages has a uuid PK with default — re-running the route would
  // double the thread. We do a coarse "delete-then-insert" of all the user's
  // chat rows because chat has no natural unique key per turn. This DOES
  // wipe legitimate prior conversation, which is acceptable for a demo
  // route: the call site is /settings, the button is labeled clearly, and
  // the user explicitly opted in.
  await admin.from('chat_messages').delete().eq('user_id', userId);
  const chatRows = generateChatRows(userId);
  const { error: chatErr } = await admin.from('chat_messages').insert(chatRows);
  if (chatErr) {
    console.error('[demo/seed] chat insert failed', chatErr);
    return NextResponse.json(
      { error: 'failed to seed chat', detail: chatErr.message },
      { status: 500 }
    );
  }

  // -------- user_profile (genome traits + onboarding metadata) --------
  // We deliberately don't touch `gender` if the user has set it; cycle entries
  // are gated on the existing value, not seeded for everyone.
  const traits = genomeTraits();
  const { data: profileBefore } = await admin
    .from('user_profile')
    .select('gender, dietary_restrictions, equipment_available, weekly_schedule, goals, notes')
    .eq('user_id', userId)
    .maybeSingle();

  const profileUpdate: Record<string, unknown> = {
    genome_traits: traits,
    genome_uploaded_at: new Date().toISOString(),
  };
  // Fill in onboarding-style fields if empty so the demo dashboard has the
  // fully-populated coaching context the briefing prompt expects.
  const goalsObj = (profileBefore?.goals ?? {}) as Record<string, unknown>;
  if (!goalsObj.primary) {
    profileUpdate.goals = {
      primary: 'sub-20 5K',
      secondary: 'build muscle without losing run pace',
    };
  }
  if (
    !profileBefore?.dietary_restrictions ||
    (profileBefore.dietary_restrictions as string[]).length === 0
  ) {
    profileUpdate.dietary_restrictions = ['shellfish allergy'];
  }
  if (
    !profileBefore?.equipment_available ||
    (profileBefore.equipment_available as string[]).length === 0
  ) {
    profileUpdate.equipment_available = [
      'gym membership',
      'dumbbells',
      'barbell',
      'pull-up bar',
      'bench',
      'treadmill',
    ];
  }
  const weeklySchedule = profileBefore?.weekly_schedule as Record<string, unknown> | null;
  if (!weeklySchedule || Object.keys(weeklySchedule).length === 0) {
    profileUpdate.weekly_schedule = {
      monday: ['lift'],
      tuesday: ['run'],
      wednesday: ['lift'],
      thursday: ['run'],
      friday: ['lift'],
      saturday: ['run', 'long'],
      sunday: ['rest'],
    };
  }
  if (!profileBefore?.notes) {
    profileUpdate.notes =
      'Building base for fall 5K. Knees fine, no injuries. Coffee in the morning.';
  }
  const { error: profErr } = await admin
    .from('user_profile')
    .update(profileUpdate)
    .eq('user_id', userId);
  if (profErr) {
    console.error('[demo/seed] profile update failed', profErr);
    return NextResponse.json(
      { error: 'failed to seed user_profile', detail: profErr.message },
      { status: 500 }
    );
  }

  // -------- blood panels --------
  // Two panels: one 90 days ago, one today. Wipe previous demo panels first
  // so idempotency holds (panels are uuid-keyed; re-running would stack).
  await admin.from('blood_panels').delete().eq('user_id', userId).eq('source', 'manual');

  const panelDates = [ymd(daysAgo(90)), ymd(daysAgo(0))];
  const panelInserts: BloodPanelInsert[] = panelDates.map((date) => ({
    user_id: userId,
    panel_date: date,
    lab: 'Quest Diagnostics',
    notes: '',
    source: 'manual',
  }));
  const { data: panelRowsRaw, error: panelErr } = await admin
    .from('blood_panels')
    .insert(panelInserts)
    .select('id, panel_date');
  if (panelErr) {
    console.error('[demo/seed] blood_panels insert failed', panelErr);
    return NextResponse.json(
      { error: 'failed to seed blood_panels', detail: panelErr.message },
      { status: 500 }
    );
  }
  const panelRows = (panelRowsRaw as Array<{ id: string }> | null) ?? [];
  let bloodMarkerCount = 0;
  if (panelRows.length > 0) {
    const allMarkers: BloodMarkerInsert[] = panelRows.flatMap((p) =>
      PANEL_MARKERS.map((m) => ({ ...m, panel_id: p.id }))
    );
    const { error: markErr } = await admin.from('blood_marker_readings').insert(allMarkers);
    if (markErr) {
      console.error('[demo/seed] blood_marker_readings insert failed', markErr);
      return NextResponse.json(
        { error: 'failed to seed blood_marker_readings', detail: markErr.message },
        { status: 500 }
      );
    }
    bloodMarkerCount = allMarkers.length;
  }

  // -------- glucose --------
  // glucose_readings has a uuid PK; same idempotency dance as chat. Scope the
  // delete to source='manual' so a future CGM import isn't wiped.
  await admin.from('glucose_readings').delete().eq('user_id', userId).eq('source', 'manual');
  const glucoseRows = generateGlucose(userId, rng);
  const { error: glucErr } = await admin.from('glucose_readings').insert(glucoseRows);
  if (glucErr) {
    console.error('[demo/seed] glucose insert failed', glucErr);
    return NextResponse.json(
      { error: 'failed to seed glucose_readings', detail: glucErr.message },
      { status: 500 }
    );
  }

  // -------- cycle entries (only if gender == 'female') --------
  let cycleCount = 0;
  if (profileBefore?.gender === 'female') {
    const cycleRows = generateCycles(userId);
    const { error: cycErr } = await admin
      .from('cycle_entries')
      .upsert(cycleRows, { onConflict: 'user_id,start_date' });
    if (cycErr) {
      console.error('[demo/seed] cycle_entries upsert failed', cycErr);
      // Non-fatal — cycle data is gated by gender, so a failure here doesn't
      // break the demo for everyone. Log and continue.
    } else {
      cycleCount = cycleRows.length;
    }
  }

  const result: SeedResult = {
    ok: true,
    seeded: {
      biometrics: biometricRows.length,
      briefings: briefingRows.length,
      chat: chatRows.length,
      blood_panels: panelRows.length,
      blood_markers: bloodMarkerCount,
      glucose_readings: glucoseRows.length,
      cycle_entries: cycleCount,
      genome_traits: Object.keys(traits).length,
    },
  };
  return NextResponse.json(result);
}
