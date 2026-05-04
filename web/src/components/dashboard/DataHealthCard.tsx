import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getAdminClient } from '@/lib/supabase/admin';
import {
  ALL_SYNC_SOURCES,
  SOURCE_POLICY,
  type SyncSource,
} from '@/lib/sync/policy';
import {
  computeDataHealth,
  type DataHealthInput,
  type HealthBand,
  type SourceConnectionState,
  type SourceAuditSummary,
  type PerSourceHealth,
} from '@/lib/sync/health-score';
import { cn } from '@/lib/utils/cn';

/**
 * Data Health card — server component. Lives near the top of /dashboard so
 * the user can tell at a glance whether their ingestion plumbing is healthy.
 *
 * The hard work — pulling per-source connection state, last-synced timestamps
 * (from `biometrics_daily` for pull sources, `apple_watch_tokens.last_used_at`
 * for the push source), and the 24h audit summary — all happens here. The
 * actual score math lives in `lib/sync/health-score.ts` and is unit-testable.
 *
 * The card itself is a click target → /settings/integrations (Track 4's sync
 * dashboard) so the user can drill into the per-source detail.
 */

interface Props {
  userId: string;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const SOURCE_SHORT_LABEL: Record<SyncSource, string> = {
  garmin: 'Garmin',
  whoop: 'Whoop',
  apple_watch: 'Apple Watch',
};

// Tailwind utility hook-up per band. The score numeral picks up the band
// colour; the dot pills mirror the same palette so the card reads as one
// state at a glance.
const BAND_NUMERAL_CLASS: Record<HealthBand, string> = {
  green: 'text-fiber',
  yellow: 'text-highlight',
  red: 'text-danger',
  gray: 'text-muted',
};

const BAND_LABEL: Record<HealthBand, string> = {
  green: 'healthy',
  yellow: 'attention',
  red: 'degraded',
  gray: 'no sources',
};

const STATUS_DOT_CLASS: Record<PerSourceHealth['status'], string> = {
  connected: 'bg-fiber',
  stale: 'bg-highlight',
  disconnected: 'bg-muted/40',
};

async function loadConnections(
  userId: string
): Promise<Record<SyncSource, SourceConnectionState>> {
  const admin = getAdminClient();

  // Garmin / Whoop / Apple Watch — connection check is a presence check on
  // the per-source credentials/tokens table. Mirrors what
  // /settings/integrations does so the two pages can never disagree.
  const [garminCred, whoopCred, appleTok] = await Promise.all([
    admin
      .from('garmin_credentials')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('whoop_credentials')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('apple_watch_tokens')
      .select('user_id, last_used_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  // Pull `biometrics_daily` for the last 14 days, NOT the merged view — we
  // need per-source `fetched_at` to know how stale each pipe is. Then group
  // by source in JS and pick the max `fetched_at`.
  const cutoff = new Date(Date.now() - FOURTEEN_DAYS_MS).toISOString();
  const { data: bioRows } = await admin
    .from('biometrics_daily')
    .select('source, fetched_at')
    .eq('user_id', userId)
    .gte('fetched_at', cutoff)
    .order('fetched_at', { ascending: false });

  const lastByPullSource: Partial<Record<SyncSource, string>> = {};
  for (const row of (bioRows ?? []) as Array<{
    source: string;
    fetched_at: string;
  }>) {
    if (row.source !== 'garmin' && row.source !== 'whoop') continue;
    if (!lastByPullSource[row.source as SyncSource]) {
      lastByPullSource[row.source as SyncSource] = row.fetched_at;
    }
  }

  return {
    garmin: {
      connected: !!garminCred.data,
      last_synced_at: lastByPullSource.garmin ?? null,
    },
    whoop: {
      connected: !!whoopCred.data,
      last_synced_at: lastByPullSource.whoop ?? null,
    },
    apple_watch: {
      connected: !!appleTok.data,
      // Apple Watch is push-only — there's no `fetched_at` on inserts. The
      // shortcut webhook bumps `last_used_at` on the token row instead.
      last_synced_at: (appleTok.data?.last_used_at as string | null) ?? null,
    },
  };
}

async function loadAudit24h(userId: string): Promise<SourceAuditSummary[]> {
  const admin = getAdminClient();
  const since = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();

  // We page through up to 1k rows — well above what one user could generate
  // in 24h with the 1h Garmin / 15m Whoop cooldowns. Group by action prefix.
  const { data } = await admin
    .from('audit_ledger')
    .select('action, status')
    .eq('user_id', userId)
    .gte('ts', since)
    .like('action', 'sync.%')
    .limit(1000);

  const counts: Record<SyncSource, { ok: number; err: number }> = {
    garmin: { ok: 0, err: 0 },
    whoop: { ok: 0, err: 0 },
    apple_watch: { ok: 0, err: 0 },
  };

  for (const row of (data ?? []) as Array<{ action: string; status: string }>) {
    // 'sync.garmin.success' / 'sync.whoop.error' → first segment after sync.
    const m = /^sync\.([a-z0-9_]+)/i.exec(row.action);
    if (!m) continue;
    const src = m[1] as SyncSource;
    if (!(src in counts)) continue;
    if (row.status === 'ok') counts[src].ok += 1;
    else if (row.status === 'error') counts[src].err += 1;
    // 'retry' / 'skipped' don't count for or against — they're noise.
  }

  return ALL_SYNC_SOURCES.map((source) => ({
    source,
    ok_count: counts[source].ok,
    error_count: counts[source].err,
  }));
}

function formatFreshness(hours: number | null): string {
  if (hours === null) return 'never';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buildSubLine(
  per: PerSourceHealth[],
  connectedCount: number,
  totalSources: number
): string {
  if (connectedCount === 0) return 'Connect a source to start tracking';

  // Single-source nudge — the card is healthy but the user has no redundancy.
  if (connectedCount === 1) {
    const only = per.find((p) => p.status !== 'disconnected');
    const label = only ? SOURCE_SHORT_LABEL[only.source] : '';
    return `1 of ${totalSources} — connect more for redundancy${
      label ? ` (only ${label})` : ''
    }`;
  }

  // Otherwise: list freshness for connected sources, ordered freshest-first
  // for the happy case, stalest-first if anything is unhappy. We highlight
  // stale > 24h since that's what's dragging the score down.
  const connected = per.filter((p) => p.status !== 'disconnected');
  const stale = connected.filter(
    (p) => p.freshness_hours !== null && p.freshness_hours > 24
  );

  if (stale.length === 0) {
    return `${connectedCount} of ${totalSources} wearables fresh`;
  }

  // Show up to 2 stale sources to keep the line tight.
  const parts = stale
    .slice(0, 2)
    .map(
      (p) =>
        `${SOURCE_SHORT_LABEL[p.source]} stale ${formatFreshness(
          p.freshness_hours
        )}`
    );
  return parts.join(' · ');
}

export async function DataHealthCard({ userId }: Props) {
  // Load both halves in parallel — they hit different tables.
  const [connections, audit24h] = await Promise.all([
    loadConnections(userId),
    loadAudit24h(userId),
  ]);

  const input: DataHealthInput = { connections, audit_24h: audit24h };
  const result = computeDataHealth(input);

  const totalSources = ALL_SYNC_SOURCES.length;
  const connectedCount = ALL_SYNC_SOURCES.filter(
    (s) => connections[s].connected
  ).length;

  // Edge case: zero sources connected → muted "connect a source" CTA.
  if (connectedCount === 0) {
    return (
      <Link
        href="/settings/integrations"
        className="glass group block rounded-2xl p-5 transition-colors hover:bg-glass-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Data health</div>
            <div className="mt-2 font-serif text-2xl leading-tight text-foreground">
              No sources connected
            </div>
            <p className="mt-1 text-xs text-muted">
              Connect Garmin, Whoop, or Apple Watch so Protocol can tune your
              plan to last night&rsquo;s recovery.
            </p>
          </div>
          <ChevronRight
            size={18}
            className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </Link>
    );
  }

  const subLine = buildSubLine(result.per_source, connectedCount, totalSources);
  const numeralClass = BAND_NUMERAL_CLASS[result.band];

  return (
    <Link
      href="/settings/integrations"
      className="glass group block rounded-2xl p-5 transition-colors hover:bg-glass-3"
      aria-label={`Data health ${result.score ?? '—'} of 100, ${
        BAND_LABEL[result.band]
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Data health</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]',
                result.band === 'green' &&
                  'border-fiber/30 bg-fiber-light text-fiber',
                result.band === 'yellow' &&
                  'border-highlight/30 bg-highlight-light text-highlight',
                result.band === 'red' && 'border-danger/30 bg-danger/10 text-danger',
                result.band === 'gray' && 'border-border bg-glass-2 text-muted'
              )}
            >
              · {BAND_LABEL[result.band]}
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                'font-serif text-5xl leading-none tabular-nums',
                numeralClass
              )}
            >
              {result.score ?? '—'}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted/70">
              / 100
            </span>
          </div>

          <p className="mt-2 text-xs text-muted">{subLine}</p>
        </div>

        <ChevronRight
          size={18}
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>

      {/* Per-source pills — small dot + label, one per source. Disconnected
          sources get a muted dot so the user sees the gap at a glance. */}
      <ul className="mt-4 flex flex-wrap gap-2">
        {result.per_source.map((p) => {
          const policy = SOURCE_POLICY[p.source];
          const isPushOnly = policy.minIntervalMs <= 0;
          const fresh = formatFreshness(p.freshness_hours);
          const title =
            p.status === 'disconnected'
              ? `${SOURCE_SHORT_LABEL[p.source]} — not connected`
              : `${SOURCE_SHORT_LABEL[p.source]} — ${
                  isPushOnly ? 'push' : 'pull'
                } · last ${fresh}`;
          return (
            <li
              key={p.source}
              title={title}
              className={cn(
                'flex items-center gap-1.5 rounded-full border border-border bg-glass-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]',
                p.status === 'disconnected' ? 'text-muted/60' : 'text-foreground'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  STATUS_DOT_CLASS[p.status]
                )}
                aria-hidden
              />
              {SOURCE_SHORT_LABEL[p.source]}
            </li>
          );
        })}
      </ul>
    </Link>
  );
}
