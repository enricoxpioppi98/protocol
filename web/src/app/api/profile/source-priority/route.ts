import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { BiometricsSource } from '@/lib/types/models';

/**
 * Source priority for `biometrics_daily_merged` (migration 013).
 *
 * The merged view picks each metric's value from the highest-priority NON-NULL
 * source the user has data for, where priority is the array index in
 * `user_profile.metric_source_priority->'default'`. v2 only consumes the
 * `default` array — every metric uses the same order. Future revisions may
 * branch by metric (e.g. user prefers Whoop's HRV but Garmin's training load).
 *
 * GET  → { priority: BiometricsSource[] } — current `default`, falling back to
 *        the migration default if the user_profile row is unset (defensive;
 *        the column is NOT NULL with a server-side default).
 * PUT  → body { priority: BiometricsSource[] }; upserts the `default` array.
 *
 * Validation:
 *   - Must be a non-empty array of strings.
 *   - Every entry must be a known `BiometricsSource`. Unknown values are
 *     dropped silently (so a stale client doesn't 400 the user; the merge
 *     view tolerates missing sources via rank=999).
 *   - De-duplicates while preserving first-seen order.
 *
 * Auth: standard Supabase session — same pattern as
 * `/api/profile/pinned-metrics/route.ts`. The RLS policy on `user_profile`
 * enforces user_id = auth.uid() for the UPDATE.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KNOWN_SOURCES: ReadonlySet<BiometricsSource> = new Set<BiometricsSource>([
  'garmin',
  'whoop',
  'apple_watch',
  'manual',
]);

const DEFAULT_PRIORITY: BiometricsSource[] = [
  'garmin',
  'whoop',
  'apple_watch',
  'manual',
];

interface PutBody {
  priority?: unknown;
}

interface PriorityRow {
  metric_source_priority: {
    default?: unknown;
  } | null;
}

function sanitizePriority(v: unknown): BiometricsSource[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<BiometricsSource>();
  const out: BiometricsSource[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const candidate = raw.trim() as BiometricsSource;
    if (!KNOWN_SOURCES.has(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_profile')
    .select('metric_source_priority')
    .eq('user_id', user.id)
    .maybeSingle<PriorityRow>();

  if (error) {
    console.error('[source-priority GET] read error', error);
    return NextResponse.json(
      { error: 'failed to read source priority' },
      { status: 500 }
    );
  }

  const stored = sanitizePriority(data?.metric_source_priority?.default);
  const priority = stored.length > 0 ? stored : DEFAULT_PRIORITY;
  return NextResponse.json({ priority });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const priority = sanitizePriority(body.priority);
  if (priority.length === 0) {
    return NextResponse.json(
      { error: 'priority must be a non-empty array of known sources' },
      { status: 400 }
    );
  }

  // Read-modify-write so we don't clobber other JSONB keys (per-metric
  // overrides) future revisions may add to `metric_source_priority`.
  const { data: existing, error: readErr } = await supabase
    .from('user_profile')
    .select('metric_source_priority')
    .eq('user_id', user.id)
    .maybeSingle<PriorityRow>();

  if (readErr) {
    console.error('[source-priority PUT] read error', readErr);
    return NextResponse.json(
      { error: 'failed to load source priority' },
      { status: 500 }
    );
  }

  const merged = {
    ...((existing?.metric_source_priority ?? {}) as Record<string, unknown>),
    default: priority,
  };

  const { error: updateErr } = await supabase
    .from('user_profile')
    .update({ metric_source_priority: merged })
    .eq('user_id', user.id);

  if (updateErr) {
    console.error('[source-priority PUT] update error', updateErr);
    return NextResponse.json(
      { error: 'failed to save source priority' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, priority });
}
