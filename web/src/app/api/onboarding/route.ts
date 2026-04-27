import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/onboarding
 * Body: {
 *   goals: { primary?: string; secondary?: string };
 *   dietary_restrictions: string[];
 *   equipment_available: string[];
 *   weekly_schedule: Record<string, string[]>;
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

  const update = {
    goals,
    dietary_restrictions: sanitizeStringArray(body.dietary_restrictions),
    equipment_available: sanitizeStringArray(body.equipment_available),
    weekly_schedule: sanitizeWeeklySchedule(body.weekly_schedule),
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
