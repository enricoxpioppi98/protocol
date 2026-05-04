import { NextResponse } from 'next/server';
import { runSync, type SyncResult } from '@/lib/sync/orchestrator';
import type { SyncSource } from '@/lib/sync/policy';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * GET/POST /api/sync/cron
 *
 * Vercel Cron entry point. Vercel cron sends GET with
 * `Authorization: Bearer ${CRON_SECRET}`. We also accept POST so the route can
 * be triggered manually via `curl -X POST` in dev.
 *
 * Iterates all users with at least one connected integration and calls
 * `runSync` for each. Uses the service-role client (no per-user session).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5min — cron can fan out to many users

interface UserCronResult {
  user_id: string;
  sources: SyncResult[];
}

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === secret;
}

async function listActiveUsers(): Promise<
  Map<string, Set<SyncSource>>
> {
  const admin = getAdminClient();
  const users = new Map<string, Set<SyncSource>>();

  const [garmin, whoop] = await Promise.all([
    admin.from('garmin_credentials').select('user_id'),
    admin.from('whoop_credentials').select('user_id'),
  ]);

  for (const row of (garmin.data ?? []) as Array<{ user_id: string }>) {
    const set = users.get(row.user_id) ?? new Set<SyncSource>();
    set.add('garmin');
    users.set(row.user_id, set);
  }
  for (const row of (whoop.data ?? []) as Array<{ user_id: string }>) {
    const set = users.get(row.user_id) ?? new Set<SyncSource>();
    set.add('whoop');
    users.set(row.user_id, set);
  }
  return users;
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const users = await listActiveUsers();
  const results: UserCronResult[] = [];

  // Sequential per-user so a single user's syncs are also serialized via the
  // orchestrator's in-process lock (and we don't blow up DB connections).
  for (const [userId, sourceSet] of users) {
    const sources = Array.from(sourceSet);
    // eslint-disable-next-line no-await-in-loop
    const sync = await runSync(userId, sources, { force: false, days: 1 });
    results.push({ user_id: userId, sources: sync });
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
