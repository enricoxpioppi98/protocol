// Sanity script — NOT a test, NOT wired into the build.
// Run manually:   node scripts/test-context.mjs
//
// Prints what `contextToPromptInput` would emit for a synthetic CoachContext.
// Used to eyeball the trend tags + Blueprint references + genome traits being
// pushed into Claude's user message during local debugging. The Supabase
// client and Next.js runtime are not loaded here — we re-implement just the
// pure parts of context.ts so this works under plain `node` with no extra deps.

const TREND_THRESHOLD = 0.05;

function avg(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function computeTrend(recent, prior, higherIsBetter) {
  if (recent.length < 2 || prior.length < 2) return 'unknown';
  const r = avg(recent);
  const p = avg(prior);
  if (p === 0) return 'unknown';
  const delta = (r - p) / p;
  if (Math.abs(delta) < TREND_THRESHOLD) return 'stable';
  if (higherIsBetter) return delta > 0 ? 'improving' : 'declining';
  return delta < 0 ? 'improving' : 'declining';
}

function pickNumeric(rows, key) {
  return rows
    .map((r) => r[key])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
}

function computeAgeYears(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const md = now.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

const BLUEPRINT_REFERENCES = {
  sleep_hours_min: 7,
  sleep_deep_plus_rem_minutes_min: 90,
  sleep_score_target: 80,
  hrv_direction: 'stable_or_up',
  rhr_athletic_max: 60,
  rhr_well_trained_max: 50,
  vo2max_target: 'above_average_for_age',
  steps_floor: 8000,
  steps_target: 10000,
  steps_movement_heavy_day: 12000,
  zone2_minutes_per_week: 90,
  vigorous_minutes_per_week: 75,
  vigorous_minutes_per_day_blueprint: 30,
  protein_g_per_lb_bodyweight: 1.0,
  fiber_g_per_day: 30,
  fiber_g_per_day_target: 40,
  polyphenol_colors_per_day: 6,
  omega3_g_per_day: 2,
  caffeine_rule: 'morning_only_if_CYP1A2_fast',
};

// ---- Synthetic mock context (38yo male, declining trend, CYP1A2 slow) ----

const today = '2026-04-27';

const profile = {
  goals: { primary: 'body recomp', secondary: 'maintain VO2max' },
  dietary_restrictions: [],
  equipment_available: ['gym membership', 'dumbbells', 'pull-up bar'],
  weekly_schedule: { monday: ['lift'], wednesday: ['run', 'easy'] },
  notes: '',
  pinned_metrics: ['sleep_score', 'hrv_ms', 'resting_hr', 'stress_avg'],
  dob: '1987-09-12',
  gender: 'male',
  height_cm: 180,
  weight_kg: 82,
  training_experience: 'intermediate',
  genome_traits: { CYP1A2: 'slow', ACTN3: 'RR' },
};

const biometrics_today = {
  date: today,
  sleep_score: 68,
  sleep_duration_minutes: 410,
  hrv_ms: 41,
  resting_hr: 56,
  stress_avg: 35,
  training_load_acute: 380,
  training_load_chronic: 420,
  total_steps: 6500,
  vigorous_minutes: 5,
  moderate_minutes: 30,
  deep_sleep_minutes: 60,
  rem_sleep_minutes: 80,
  vo2max: 49,
  source: 'garmin',
};

// Last 3 days: declining sleep + HRV
const last3 = [
  { date: '2026-04-26', sleep_score: 70, hrv_ms: 43, resting_hr: 56, training_load_acute: 380, total_steps: 7000 },
  { date: '2026-04-25', sleep_score: 67, hrv_ms: 42, resting_hr: 57, training_load_acute: 360, total_steps: 8200 },
  { date: '2026-04-24', sleep_score: 71, hrv_ms: 44, resting_hr: 55, training_load_acute: 400, total_steps: 9000 },
];
// Prior 4 days: better baseline
const prior4 = [
  { date: '2026-04-23', sleep_score: 80, hrv_ms: 51, resting_hr: 52, training_load_acute: 420, total_steps: 10500 },
  { date: '2026-04-22', sleep_score: 82, hrv_ms: 53, resting_hr: 51, training_load_acute: 410, total_steps: 11200 },
  { date: '2026-04-21', sleep_score: 78, hrv_ms: 50, resting_hr: 53, training_load_acute: 400, total_steps: 9800 },
  { date: '2026-04-20', sleep_score: 81, hrv_ms: 52, resting_hr: 52, training_load_acute: 415, total_steps: 10800 },
];

const trends = {
  sleep_trend: computeTrend(pickNumeric(last3, 'sleep_score'), pickNumeric(prior4, 'sleep_score'), true),
  hrv_trend: computeTrend(pickNumeric(last3, 'hrv_ms'), pickNumeric(prior4, 'hrv_ms'), true),
  rhr_trend: computeTrend(pickNumeric(last3, 'resting_hr'), pickNumeric(prior4, 'resting_hr'), false),
  training_load_trend: computeTrend(
    pickNumeric(last3, 'training_load_acute'),
    pickNumeric(prior4, 'training_load_acute'),
    true
  ),
};

const promptInput = {
  date: today,
  day_of_week: new Date(today).toLocaleString('en-US', { weekday: 'long' }),
  demographics: {
    age_years: computeAgeYears(profile.dob),
    gender: profile.gender,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    training_experience: profile.training_experience,
  },
  biometrics: biometrics_today,
  biometrics_last_3_days: last3,
  trends,
  goal: { kcal: 2200, p: 180, c: 220, f: 70, fiber: 35 },
  macros_logged_today: { kcal: 0, p: 0, c: 0, f: 0, fiber: 0 },
  yesterday_workout: null,
  genome_traits: profile.genome_traits,
  blueprint_references: BLUEPRINT_REFERENCES,
};

console.log('=== Synthetic prompt input that would be sent to Claude ===\n');
console.log(JSON.stringify(promptInput, null, 2));
console.log('\n=== Trend tags (last 3 days vs prior 4 days, ±5% threshold) ===');
console.log(trends);
console.log('\n=== Computed age from dob:', profile.dob, '→', computeAgeYears(profile.dob), 'years ===');
