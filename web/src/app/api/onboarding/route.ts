import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Gender, TrainingExperience } from '@/lib/types/models';

/**
 * POST /api/onboarding
 * Body: {
 *   goals: { primary?: string; secondary?: string };
 *   dietary_restrictions: string[];
 *   equipment_available: string[];
 *   weekly_schedule: Record<string, string[]>;
 *   // Demographics (all optional — coach v2)
 *   dob?: string | null;
 *   gender?: Gender | null;
 *   height_cm?: number | null;
 *   weight_kg?: number | null;
 *   training_experience?: TrainingExperience | null;
 * }
 *
 * Updates the signed-in user's `user_profile` row. The row is created empty
 * at signup by the `handle_new_user` trigger — this just fills it in. The
 * call is idempotent: re-running onboarding overwrites prior values.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OnboardingBody {
  goals?: { primary?: unknown; secondary?: unknown };
  dietary_restrictions?: unknown;
  equipment_available?: unknown;
  weekly_schedule?: unknown;
  dob?: unknown;
  gender?: unknown;
  height_cm?: unknown;
  weight_kg?: unknown;
  training_experience?: unknown;
}

const VALID_DAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const VALID_GENDERS = new Set<Gender>([
  'male',
  'female',
  'nonbinary',
  'prefer_not_to_say',
]);

const VALID_TRAINING_EXPERIENCE = new Set<TrainingExperience>([
  'beginner',
  'intermediate',
  'advanced',
]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function sanitizeStringArray(v: unknown): string[] {
  if (!isStringArray(v)) return [];
  // Trim, drop empty, dedupe (case-insensitive on the trimmed value).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function sanitizeWeeklySchedule(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [rawDay, rawValue] of Object.entries(v as Record<string, unknown>)) {
    const day = rawDay.toLowerCase();
    if (!VALID_DAYS.has(day)) continue;
    const activities = sanitizeStringArray(rawValue);
    if (activities.length > 0) {
      out[day] = activities;
    }
  }
  return out;
}

function sanitizeDob(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Accept YYYY-MM-DD (HTML date input). Anything else → null.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  // Sanity check: not in the future, and within a 130y window.
  const now = new Date();
  if (d.getTime() > now.getTime()) return null;
  const minBirth = new Date(now.getFullYear() - 130, now.getMonth(), now.getDate());
  if (d.getTime() < minBirth.getTime()) return null;
  return trimmed;
}

function sanitizeGender(v: unknown): Gender | null {
  if (typeof v !== 'string') return null;
  return VALID_GENDERS.has(v as Gender) ? (v as Gender) : null;
}

function sanitizeTrainingExperience(v: unknown): TrainingExperience | null {
  if (typeof v !== 'string') return null;
  return VALID_TRAINING_EXPERIENCE.has(v as TrainingExperience)
    ? (v as TrainingExperience)
    : null;
}

function sanitizePositiveReal(
  v: unknown,
  min: number,
  max: number
): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return Math.round(v * 10) / 10; // 1 decimal place
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as OnboardingBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const primaryRaw = body.goals?.primary;
  const secondaryRaw = body.goals?.secondary;
  const primary = typeof primaryRaw === 'string' ? primaryRaw.trim() : '';
  const secondary = typeof secondaryRaw === 'string' ? secondaryRaw.trim() : '';

  if (!primary) {
    return NextResponse.json(
      { error: 'goals.primary is required' },
      { status: 400 }
    );
  }

  const goals: { primary: string; secondary?: string } = { primary };
  if (secondary) goals.secondary = secondary;

  const update: Record<string, unknown> = {
    goals,
    dietary_restrictions: sanitizeStringArray(body.dietary_restrictions),
    equipment_available: sanitizeStringArray(body.equipment_available),
    weekly_schedule: sanitizeWeeklySchedule(body.weekly_schedule),
    dob: sanitizeDob(body.dob),
    gender: sanitizeGender(body.gender),
    height_cm: sanitizePositiveReal(body.height_cm, 80, 260),
    weight_kg: sanitizePositiveReal(body.weight_kg, 25, 300),
    training_experience: sanitizeTrainingExperience(body.training_experience),
  };

  const { error } = await supabase
    .from('user_profile')
    .update(update)
    .eq('user_id', user.id);

  if (error) {
    console.error('[onboarding] update error', error);
    return NextResponse.json({ error: 'failed to save profile' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
