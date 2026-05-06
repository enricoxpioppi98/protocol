import Link from 'next/link';
import {
  Activity,
  Beaker,
  ChevronLeft,
  ChevronRight,
  Droplet,
  Moon,
  Smartphone,
  Watch,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { SOURCE_POLICY, type SyncSource } from '@/lib/sync/policy';
import type { Gender } from '@/lib/types/models';
import { GarminConnectForm } from '@/components/sync/GarminConnectForm';
import { SyncNowButton } from '@/components/sync/SyncNowButton';
import { AuditTimeline, type AuditRow } from '@/components/sync/AuditTimeline';
import { SyncHealthCard } from '@/components/dashboard/SyncHealthCard';

/**
 * Sync dashboard — the visible v2 artifact.
 *
 * Server component. Loads per-source connection state + last-synced
 * timestamp + recent audit rows in one shot, then hands the interactive bits
 * to small client islands (`<GarminConnectForm>`, `<SyncNowButton>`,
 * `<AuditTimeline>`).
 *
 * The three main wearables (Garmin, Whoop, Apple Watch) get the full sync
 * treatment: status badge, freshness, next scheduled pull, sync-now button.
 * The optional manual signals (CGM, blood markers, cycle) keep their thin
 * card style — they have no orchestrator-managed sync to surface.
 */

export const dynamic = 'force-dynamic';

type SourceStatus = 'connected' | 'disconnected' | 'recently_errored';

interface SourceCardData {
  source: SyncSource;
  connected: boolean;
  lastSyncedAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  status: SourceStatus;
}

const RECENT_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadSourceCard(
  userId: string,
  source: SyncSource
): Promise<SourceCardData> {
  const admin = getAdminClient();

  // Connection check — different table per source.
  let connected = false;
  if (source === 'garmin') {
    const { data } = await admin
      .from('garmin_credentials')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    connected = !!data;
  } else if (source === 'whoop') {
    const { data } = await admin
      .from('whoop_credentials')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    connected = !!data;
  } else if (source === 'apple_watch') {
    const { data } = await admin
      .from('apple_watch_tokens')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    connected = !!data;
  }

  // Last synced — for Garmin/Whoop, the most recent biometrics_daily row for
  // that source; for Apple Watch (push-only), the token's last_used_at since
  // we never write a fetched_at on push ingest.
  let lastSyncedAt: string | null = null;
  if (source === 'apple_watch') {
    const { data } = await admin
      .from('apple_watch_tokens')
      .select('last_used_at')
      .eq('user_id', userId)
      .maybeSingle();
    lastSyncedAt = (data?.last_used_at as string | null) ?? null;
  } else {
    const { data } = await admin
      .from('biometrics_daily')
      .select('fetched_at')
      .eq('user_id', userId)
      .eq('source', source)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastSyncedAt = (data?.fetched_at as string | null) ?? null;
  }

  // Last sync error in the past 24h — drives the "recently_errored" badge.
  const since = new Date(Date.now() - RECENT_ERROR_WINDOW_MS).toISOString();
  const { data: errRow } = await admin
    .from('audit_ledger')
    .select('ts, error_message')
    .eq('user_id', userId)
    .like('action', `sync.${source}%`)
    .eq('status', 'error')
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle();

  // If a successful sync landed *after* the most recent error, the source has
  // already recovered — don't show red.
  let status: SourceStatus = connected ? 'connected' : 'disconnected';
  if (connected && errRow) {
    const errAt = (errRow.ts as string | null) ?? null;
    const errAfterLastSync =
      errAt !== null &&
      (lastSyncedAt === null || new Date(errAt) > new Date(lastSyncedAt));
    if (errAfterLastSync) status = 'recently_errored';
  }

  return {
    source,
    connected,
    lastSyncedAt,
    lastErrorAt: (errRow?.ts as string | null) ?? null,
    lastErrorMessage: (errRow?.error_message as string | null) ?? null,
    status,
  };
}

async function loadRecentAudit(userId: string, limit = 50): Promise<AuditRow[]> {
  // Use the admin client so this works even before the user has ever logged
  // into Realtime (RLS would still hide other users' rows, but we're already
  // scoping by user_id here).
  const admin = getAdminClient();
  const since = new Date(Date.now() - RECENT_ERROR_WINDOW_MS).toISOString();
  const { data } = await admin
    .from('audit_ledger')
    .select(
      'id, ts, actor, action, target, purpose, status, ms_elapsed, rows_affected, error_message'
    )
    .eq('user_id', userId)
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditRow[];
}

async function loadGender(userId: string): Promise<Gender | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('user_profile')
    .select('gender')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.gender ?? null) as Gender | null;
}

function nextScheduledPull(): Date {
  // Cron runs at 08:00 UTC daily (see vercel.json). If we're past today's
  // run, the next one is tomorrow at 08:00.
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      8,
      0,
      0,
      0
    )
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 30) return `${day} days ago`;
  return new Date(iso).toLocaleDateString();
}

function formatNextPull(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const hr = Math.max(0, Math.round(diffMs / (60 * 60 * 1000)));
  if (hr <= 1) return 'in <1 hour';
  if (hr < 24) return `in ~${hr} hours`;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

const SOURCE_META: Record<
  SyncSource,
  {
    title: string;
    blurb: string;
    icon: React.ReactNode;
    eyebrow: string;
    pushOnly?: boolean;
  }
> = {
  garmin: {
    title: 'Garmin Connect',
    blurb: 'Sleep, HRV, RHR, stress, training load.',
    eyebrow: 'Wearable',
    icon: <Watch size={18} />,
  },
  whoop: {
    title: 'Whoop',
    blurb: 'Recovery, strain, sleep stages, HRV, RHR.',
    eyebrow: 'OAuth',
    icon: <Activity size={18} />,
  },
  apple_watch: {
    title: 'Apple Watch',
    blurb: 'HealthKit via iOS Shortcut. Push-only.',
    eyebrow: 'Webhook',
    icon: <Smartphone size={18} />,
    pushOnly: true,
  },
};

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted">
        <p>Please sign in to manage integrations.</p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const [garmin, whoop, appleWatch, audit, gender] = await Promise.all([
    loadSourceCard(user.id, 'garmin'),
    loadSourceCard(user.id, 'whoop'),
    loadSourceCard(user.id, 'apple_watch'),
    loadRecentAudit(user.id, 50),
    loadGender(user.id),
  ]);

  const showCycle = gender === null || gender === 'female' || gender === 'nonbinary';
  const nextPullAt = nextScheduledPull();

  return (
    <div className="space-y-5">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        Settings
      </Link>

      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="eyebrow text-accent">Sync · data sources</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          Integrations
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          One pane of glass for every source Protocol pulls from. Connection
          state, last sync, next scheduled pull, and a live audit timeline so
          you can see exactly what landed when.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <span className="rounded-full border border-border bg-glass-2 px-2 py-0.5 font-mono uppercase tracking-[0.16em]">
            Next cron · {formatNextPull(nextPullAt)}
          </span>
          <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.16em] text-muted/60">
            08:00 UTC daily
          </span>
        </div>
      </header>

      <SyncHealthCard userId={user.id} />

      {/* ============== Wearable sources ============== */}
      <div className="flex items-center gap-3 pt-1">
        <span className="font-mono text-[10px] tabular-nums tracking-widest text-muted/50">
          01
        </span>
        <span className="eyebrow">Wearables</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <SourceCard data={garmin} nextPullAt={nextPullAt}>
        <GarminConnectForm />
      </SourceCard>

      <SourceCard data={whoop} nextPullAt={nextPullAt}>
        <Link
          href="/settings/integrations/whoop"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent transition-colors hover:bg-glass-3"
        >
          {whoop.connected ? 'Manage OAuth' : 'Connect via OAuth'}
          <ChevronRight size={12} />
        </Link>
      </SourceCard>

      <SourceCard data={appleWatch} nextPullAt={nextPullAt}>
        <Link
          href="/settings/integrations/apple-watch"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent transition-colors hover:bg-glass-3"
        >
          {appleWatch.connected
            ? 'Manage Shortcut webhook'
            : 'Set up iOS Shortcut'}
          <ChevronRight size={12} />
        </Link>
      </SourceCard>

      {/* ============== Recent activity timeline ============== */}
      <div className="flex items-center gap-3 pt-2">
        <span className="font-mono text-[10px] tabular-nums tracking-widest text-muted/50">
          02
        </span>
        <span className="eyebrow">Recent activity · last 24h</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <section className="glass rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs leading-relaxed text-muted">
            Live audit feed — every sync, retry, and skip lands here. Updates in
            real time.
          </p>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted/60">
            · live
          </span>
        </div>
        <AuditTimeline userId={user.id} initialRows={audit} />
      </section>

      {/* ============== Optional manual signals ============== */}
      <div className="mt-2 flex items-center gap-3 pt-1">
        <span className="font-mono text-[10px] tabular-nums tracking-widest text-muted/50">
          03
        </span>
        <span className="eyebrow">Optional signals · manual entry</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <SignalCard
        href="/settings/integrations/cgm"
        eyebrow="Glucose"
        title="CGM"
        subtitle="Manual mg/dL entries — fasting, post-meal, overnight."
        icon={<Droplet size={18} />}
      />
      <SignalCard
        href="/settings/integrations/blood-markers"
        eyebrow="Bloodwork"
        title="Blood markers"
        subtitle="Quarterly panels — apoB, hsCRP, hbA1c, lipid. PDF auto-parse."
        icon={<Beaker size={18} />}
      />
      {showCycle ? (
        <SignalCard
          href="/settings/integrations/cycle"
          eyebrow="Cycle"
          title="Menstrual phase"
          subtitle="Period starts → computed phase. Coach adjusts intensity."
          icon={<Moon size={18} />}
        />
      ) : null}
    </div>
  );
}

function SourceCard({
  data,
  nextPullAt,
  children,
}: {
  data: SourceCardData;
  nextPullAt: Date;
  children?: React.ReactNode;
}) {
  const meta = SOURCE_META[data.source];
  const policy = SOURCE_POLICY[data.source];
  const isPushOnly = policy.minIntervalMs <= 0;

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl border border-border bg-glass-2 p-2 text-accent">
          {meta.icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-xl text-foreground">{meta.title}</h2>
            <span className="rounded-full border border-border bg-glass-2 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
              {meta.eyebrow}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">{meta.blurb}</p>
        </div>
        <StatusBadge status={data.status} />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Stat label="Last sync" value={formatRelative(data.lastSyncedAt)} />
        <Stat
          label="Next pull"
          value={
            isPushOnly ? 'push only' : formatNextPull(nextPullAt)
          }
        />
        <Stat
          label="Cooldown"
          value={
            isPushOnly
              ? '—'
              : policy.minIntervalMs >= 60 * 60 * 1000
                ? `${Math.round(policy.minIntervalMs / (60 * 60 * 1000))}h`
                : `${Math.round(policy.minIntervalMs / 60000)}m`
          }
        />
      </dl>

      {data.status === 'recently_errored' && data.lastErrorMessage ? (
        <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          Last error: {data.lastErrorMessage}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SyncNowButton source={data.source} enabled={data.connected} />
        <div>{children}</div>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: SourceStatus }) {
  if (status === 'connected') {
    return (
      <span className="rounded-full border border-fiber/30 bg-fiber-light px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fiber">
        · connected
      </span>
    );
  }
  if (status === 'recently_errored') {
    return (
      <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-danger">
        · errored
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border bg-glass-2 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
      · disconnected
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function SignalCard({
  href,
  eyebrow,
  title,
  subtitle,
  icon,
}: {
  href: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="glass group flex items-center gap-3 rounded-2xl px-5 py-4 transition-colors hover:bg-glass-3"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-glass-2 text-accent">
        {icon}
      </span>
      <div className="flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          {eyebrow}
        </div>
        <div className="font-serif text-base text-foreground">{title}</div>
        <div className="text-xs text-muted">{subtitle}</div>
      </div>
      <span className="font-mono text-muted transition-transform group-hover:translate-x-0.5">
        &rsaquo;
      </span>
    </Link>
  );
}
