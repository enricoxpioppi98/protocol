/**
 * Per-source minimum-interval cooldown policy. The orchestrator consults this
 * before kicking off a pull so a user (or cron) hammering the "Sync now" button
 * can't melt the upstream service or our rate budget.
 *
 * `apple_watch` is push-only (the iOS Shortcut webhooks into us); we never pull,
 * so its interval is 0 — `runSync` returns `skipped: 'push_only'` for it.
 */

export const SOURCE_POLICY = {
  garmin: { minIntervalMs: 60 * 60 * 1000, label: 'Garmin' }, // 1 hour
  whoop: { minIntervalMs: 15 * 60 * 1000, label: 'Whoop' }, // 15 minutes
  apple_watch: { minIntervalMs: 0, label: 'Apple Watch' }, // push-only
} as const;

export type SyncSource = keyof typeof SOURCE_POLICY;

export const ALL_SYNC_SOURCES: readonly SyncSource[] = Object.keys(
  SOURCE_POLICY
) as SyncSource[];

export function canSyncNow(
  source: SyncSource,
  lastSyncedAt: string | Date | null | undefined
): boolean {
  const policy = SOURCE_POLICY[source];
  if (policy.minIntervalMs <= 0) return false; // push-only sources never pull
  if (!lastSyncedAt) return true;
  const last = lastSyncedAt instanceof Date ? lastSyncedAt : new Date(lastSyncedAt);
  if (Number.isNaN(last.getTime())) return true;
  return Date.now() - last.getTime() >= policy.minIntervalMs;
}
