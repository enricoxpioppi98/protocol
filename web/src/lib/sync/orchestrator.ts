import type { SupabaseClient } from '@supabase/supabase-js';
import { logAudit } from '@/lib/audit/broker';
import { getAdminClient } from '@/lib/supabase/admin';
import { canSyncNow, SOURCE_POLICY, type SyncSource } from './policy';
import { GarminSyncError, syncGarmin } from './sources/garmin';
import { syncWhoop, WhoopSyncError } from './sources/whoop';

/**
 * The orchestrator. Fans out to per-source fetchers, applies the cooldown
 * policy, and serializes concurrent triggers for a given user via an
 * in-process promise map.
 *
 * Per-source result is shaped so the future audit_ledger (Track 3) can
 * insert it 1:1.
 */

export type SyncStatus = 'ok' | 'error' | 'skipped';
export type SyncSkipReason = 'cooldown' | 'push_only' | 'not_connected';

export interface SyncResult {
  source: SyncSource;
  status: SyncStatus;
  ms: number;
  rowsAffected: number;
  reason?: SyncSkipReason;
  errorMessage?: string;
}

export interface RunSyncOpts {
  force?: boolean;
  days?: number;
  /**
   * Optional Supabase client to use for writes that should remain RLS-scoped
   * (e.g. the manual `/api/biometrics/sync` route). Defaults to admin.
   */
  writeClient?: SupabaseClient;
}

const inflight = new Map<string, Promise<SyncResult[]>>();

async function lastSyncedAtFor(
  userId: string,
  source: SyncSource
): Promise<string | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('biometrics_daily')
    .select('fetched_at')
    .eq('user_id', userId)
    .eq('source', source)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.fetched_at as string | undefined) ?? null;
}

async function runOne(
  userId: string,
  source: SyncSource,
  opts: RunSyncOpts
): Promise<SyncResult> {
  const started = Date.now();

  // Apple Watch is push-only — webhook ingest path lives in
  // `/api/biometrics/apple-watch`. Pulls are not implemented.
  if (SOURCE_POLICY[source].minIntervalMs <= 0) {
    return {
      source,
      status: 'skipped',
      ms: Date.now() - started,
      rowsAffected: 0,
      reason: 'push_only',
    };
  }

  if (!opts.force) {
    const last = await lastSyncedAtFor(userId, source);
    if (!canSyncNow(source, last)) {
      return {
        source,
        status: 'skipped',
        ms: Date.now() - started,
        rowsAffected: 0,
        reason: 'cooldown',
      };
    }
  }

  try {
    let rowsAffected = 0;
    if (source === 'garmin') {
      const r = await syncGarmin({
        userId,
        days: opts.days,
        writeClient: opts.writeClient,
      });
      rowsAffected = r.rowsAffected;
    } else if (source === 'whoop') {
      const r = await syncWhoop({ userId, days: opts.days });
      rowsAffected = r.rowsAffected;
    }

    logAudit({
      actor: userId,
      action: `sync.${source}.success`,
      target: 'biometrics_daily',
      purpose: 'biometrics_sync',
      ts: new Date().toISOString(),
    });

    return {
      source,
      status: 'ok',
      ms: Date.now() - started,
      rowsAffected,
    };
  } catch (err) {
    const message =
      err instanceof GarminSyncError || err instanceof WhoopSyncError
        ? `${err.kind}: ${err.message}`
        : (err as Error).message || 'unknown error';

    // Treat "not connected / not configured" as a skip rather than an error
    // so dashboard cards don't show red for users who never connected.
    if (
      (err instanceof GarminSyncError &&
        (err.kind === 'no_credentials' || err.kind === 'not_configured')) ||
      (err instanceof WhoopSyncError &&
        (err.kind === 'not_connected' || err.kind === 'not_configured'))
    ) {
      return {
        source,
        status: 'skipped',
        ms: Date.now() - started,
        rowsAffected: 0,
        reason: 'not_connected',
      };
    }

    logAudit({
      actor: userId,
      action: `sync.${source}.error`,
      target: 'biometrics_daily',
      purpose: 'biometrics_sync',
      ts: new Date().toISOString(),
    });

    return {
      source,
      status: 'error',
      ms: Date.now() - started,
      rowsAffected: 0,
      errorMessage: message,
    };
  }
}

export async function runSync(
  userId: string,
  sources: SyncSource[],
  opts: RunSyncOpts = {}
): Promise<SyncResult[]> {
  const key = `${userId}::${sources.slice().sort().join(',')}::${opts.force ? 'f' : 'n'}::${opts.days ?? ''}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const exec = (async () => {
    const results: SyncResult[] = [];
    for (const source of sources) {
      // eslint-disable-next-line no-await-in-loop -- sources run sequentially
      // so we don't hammer the same Garmin login from two parallel pulls.
      results.push(await runOne(userId, source, opts));
    }
    return results;
  })();

  inflight.set(key, exec);
  try {
    return await exec;
  } finally {
    inflight.delete(key);
  }
}
