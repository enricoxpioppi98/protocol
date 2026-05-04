/**
 * Tool definitions for the Protocol MCP server.
 *
 * Four tools, all read-only against the user's Supabase:
 *
 *   1. get_data_health        — per-source connection state + 24h sync stats
 *   2. get_biometrics_range   — N days of one metric from biometrics_daily_merged
 *   3. get_today_briefing     — today's daily_briefing row (text + workout JSON)
 *   4. get_recent_audit       — latest 50 audit_ledger rows for the user
 *
 * Every tool returns MCP-shaped content blocks: a one-line text summary so the
 * Claude Desktop tool-call panel reads cleanly, plus a JSON block carrying the
 * structured payload. Errors return `isError: true` with a text reason — they
 * never throw out of the handler (the SDK would surface the raw stack to the
 * model, which is useless and leaks paths).
 */

import { z } from 'zod';
import { getSupabase, PROTOCOL_USER_ID } from './supabase.js';

// --------------------------------------------------------------------------
// Shared types & helpers
// --------------------------------------------------------------------------

export interface ToolResultContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

/** All sync sources Protocol knows about. Mirrors web/src/lib/sync/policy.ts. */
const SYNC_SOURCES = ['garmin', 'whoop', 'apple_watch'] as const;
type SyncSource = (typeof SYNC_SOURCES)[number];

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Wrap a JSON payload as a text content block. We tag it with a fenced ```json
 * marker so Claude Desktop renders it as a code block and the model parses it
 * back unambiguously. Embedded-resource blocks would be tidier but the SDK's
 * type accepts only text/image/resource shapes that don't all round-trip
 * through Claude Desktop yet (resource blocks are fine via stdio but render
 * inconsistently).
 */
function jsonBlock(value: unknown): ToolResultContent {
  return {
    type: 'text',
    text: '```json\n' + JSON.stringify(value, null, 2) + '\n```',
  };
}

function textBlock(text: string): ToolResultContent {
  return { type: 'text', text };
}

function errorResult(message: string): ToolResult {
  return {
    isError: true,
    content: [textBlock(`Error: ${message}`)],
  };
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / (60 * 60 * 1000));
}

function fmtFreshness(hours: number | null): string {
  if (hours === null) return 'never';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// --------------------------------------------------------------------------
// Tool 1: get_data_health
// --------------------------------------------------------------------------
//
// Mirrors the loaders in web/src/components/dashboard/DataHealthCard.tsx but
// returns raw structured state instead of computing the 0..100 score — Claude
// is better at narrating the state than reading a number, and the formula is
// owned by the web app.

const GetDataHealthInput = z.object({}).strict();

export const getDataHealthTool = {
  name: 'get_data_health',
  description:
    "Snapshot of the user's data ingestion plumbing. Returns per-source connection state " +
    '(garmin, whoop, apple_watch), last-synced timestamps, hours-since-sync, and 24h ' +
    'success/error counts from the audit ledger. Use this when the user asks "is my ' +
    'data flowing" / "when did Garmin last sync" / "is anything broken".',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  zodSchema: GetDataHealthInput,
  async run(_args: z.infer<typeof GetDataHealthInput>): Promise<ToolResult> {
    const sb = getSupabase();
    const userId = PROTOCOL_USER_ID;

    // --- connection presence + last-used timestamp per source ---
    const cutoff = new Date(Date.now() - FOURTEEN_DAYS_MS).toISOString();

    const [garminCred, whoopCred, appleTok, bioRows, auditRows] = await Promise.all([
      sb.from('garmin_credentials').select('user_id').eq('user_id', userId).maybeSingle(),
      sb.from('whoop_credentials').select('user_id').eq('user_id', userId).maybeSingle(),
      sb
        .from('apple_watch_tokens')
        .select('user_id, last_used_at')
        .eq('user_id', userId)
        .maybeSingle(),
      // Per-source freshness: most-recent fetched_at by source in last 14d.
      sb
        .from('biometrics_daily')
        .select('source, fetched_at')
        .eq('user_id', userId)
        .gte('fetched_at', cutoff)
        .order('fetched_at', { ascending: false }),
      // 24h sync audit: only sync.* actions, group by source prefix in JS.
      sb
        .from('audit_ledger')
        .select('action, status')
        .eq('user_id', userId)
        .gte('ts', new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString())
        .like('action', 'sync.%')
        .limit(1000),
    ]);

    if (garminCred.error) return errorResult(`garmin_credentials: ${garminCred.error.message}`);
    if (whoopCred.error) return errorResult(`whoop_credentials: ${whoopCred.error.message}`);
    if (appleTok.error) return errorResult(`apple_watch_tokens: ${appleTok.error.message}`);
    if (bioRows.error) return errorResult(`biometrics_daily: ${bioRows.error.message}`);
    if (auditRows.error) return errorResult(`audit_ledger: ${auditRows.error.message}`);

    // Group bioRows by source, picking the freshest fetched_at for pull sources.
    const lastBySource: Partial<Record<SyncSource, string>> = {};
    for (const row of (bioRows.data ?? []) as Array<{ source: string; fetched_at: string }>) {
      if (row.source === 'garmin' || row.source === 'whoop') {
        if (!lastBySource[row.source as SyncSource]) {
          lastBySource[row.source as SyncSource] = row.fetched_at;
        }
      }
    }

    // Group audit_ledger by source prefix in `sync.<source>.<status>`.
    const auditCounts: Record<SyncSource, { ok: number; error: number }> = {
      garmin: { ok: 0, error: 0 },
      whoop: { ok: 0, error: 0 },
      apple_watch: { ok: 0, error: 0 },
    };
    for (const row of (auditRows.data ?? []) as Array<{ action: string; status: string }>) {
      const m = /^sync\.([a-z0-9_]+)/i.exec(row.action);
      if (!m) continue;
      const src = m[1] as SyncSource;
      if (!(src in auditCounts)) continue;
      if (row.status === 'ok') auditCounts[src].ok += 1;
      else if (row.status === 'error') auditCounts[src].error += 1;
    }

    const perSource = SYNC_SOURCES.map((source) => {
      let connected = false;
      let lastSyncedAt: string | null = null;

      if (source === 'garmin') {
        connected = !!garminCred.data;
        lastSyncedAt = lastBySource.garmin ?? null;
      } else if (source === 'whoop') {
        connected = !!whoopCred.data;
        lastSyncedAt = lastBySource.whoop ?? null;
      } else {
        // apple_watch is push-only; freshness comes from the token row.
        connected = !!appleTok.data;
        lastSyncedAt = (appleTok.data?.last_used_at as string | null) ?? null;
      }

      const hours = hoursSince(lastSyncedAt);
      return {
        source,
        connected,
        last_synced_at: lastSyncedAt,
        hours_since_sync: hours,
        audit_24h: auditCounts[source],
      };
    });

    const connectedCount = perSource.filter((p) => p.connected).length;
    const summary =
      connectedCount === 0
        ? 'No sources connected.'
        : perSource
            .filter((p) => p.connected)
            .map((p) => `${p.source}: ${fmtFreshness(p.hours_since_sync)}`)
            .join(' · ');

    const payload = {
      generated_at: new Date().toISOString(),
      connected_count: connectedCount,
      total_sources: SYNC_SOURCES.length,
      per_source: perSource,
    };

    return {
      content: [
        textBlock(`Data health — ${summary}`),
        jsonBlock(payload),
      ],
    };
  },
};

// --------------------------------------------------------------------------
// Tool 2: get_biometrics_range
// --------------------------------------------------------------------------
//
// Default reads from the merged view (per-metric priority resolution); pass
// `source` to read directly from biometrics_daily for a specific device.

const ALLOWED_SOURCES = ['merged', 'garmin', 'whoop', 'apple_watch', 'manual'] as const;

const GetBiometricsRangeInput = z
  .object({
    metric: z
      .string()
      .min(1)
      .describe(
        'Column name on biometrics_daily / biometrics_daily_merged, e.g. "hrv_ms", ' +
          '"sleep_score", "resting_hr", "training_load_acute", "total_steps", "vo2max".'
      ),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .describe('How many days back from today (inclusive). 1..365.'),
    source: z
      .enum(ALLOWED_SOURCES)
      .optional()
      .default('merged')
      .describe(
        'Which source to read from. "merged" uses biometrics_daily_merged ' +
          '(per-metric priority). Pass a specific source to bypass the merge.'
      ),
  })
  .strict();

export const getBiometricsRangeTool = {
  name: 'get_biometrics_range',
  description:
    'Fetch a time series for one biometric column (e.g. hrv_ms, sleep_score, resting_hr) ' +
    'over the last N days. Returns chronological [{date, value}] rows plus a tiny ' +
    'min/mean/max summary. Use this for "how has my HRV trended this week", "what was ' +
    'my best sleep score in May", "show me resting HR for the last month".',
  inputSchema: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        description:
          'Column name on biometrics_daily / biometrics_daily_merged (e.g. hrv_ms, sleep_score).',
      },
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 365,
        description: 'How many days back from today (inclusive).',
      },
      source: {
        type: 'string',
        enum: [...ALLOWED_SOURCES],
        default: 'merged',
        description:
          'Which source to read from. Default "merged" uses the priority-resolved view.',
      },
    },
    required: ['metric', 'days'],
    additionalProperties: false,
  },
  zodSchema: GetBiometricsRangeInput,
  async run(args: z.infer<typeof GetBiometricsRangeInput>): Promise<ToolResult> {
    const sb = getSupabase();

    // Reject SQL-injection-shaped column names defensively. supabase-js builds
    // .select() as a string into the URL, and `metric` is user-controlled here.
    if (!/^[a-z_][a-z0-9_]*$/i.test(args.metric)) {
      return errorResult(
        `Invalid metric name: "${args.metric}". Must match /^[a-z_][a-z0-9_]*$/i.`
      );
    }

    const today = new Date();
    const cutoff = new Date(today.getTime() - args.days * 24 * 60 * 60 * 1000);
    const cutoffDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

    const useMerged = args.source === 'merged';
    const table = useMerged ? 'biometrics_daily_merged' : 'biometrics_daily';
    const selectCols = useMerged
      ? `date, ${args.metric}`
      : `date, ${args.metric}, source`;

    // Build the filter chain first, THEN apply order — `.order()` returns a
    // transform builder you can't add filters to. Conditional filters all
    // attach before the order call.
    const base = sb
      .from(table)
      .select(selectCols)
      .eq('user_id', PROTOCOL_USER_ID)
      .gte('date', cutoffDate);

    const filtered = useMerged ? base : base.eq('source', args.source);

    const { data, error } = await filtered.order('date', { ascending: true });
    if (error) {
      // Most likely failure: unknown column name → 42703 from Postgres.
      return errorResult(
        `${table}.${args.metric}: ${error.message}` +
          (error.code === '42703' ? ' (no such column on this table)' : '')
      );
    }

    type Row = Record<string, unknown> & { date: string };
    const rows = (data ?? []) as Row[];

    // We keep null-valued days in the series so the caller can see gaps;
    // the stats summary below filters them out for min/mean/max.
    const series = rows.map((r) => ({
      date: r.date,
      value: r[args.metric] as number | null,
    }));

    const numericValues = series
      .map((r) => r.value)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    const stats =
      numericValues.length > 0
        ? {
            count: numericValues.length,
            min: Math.min(...numericValues),
            max: Math.max(...numericValues),
            mean:
              Math.round(
                (numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 100
              ) / 100,
            first: { date: series[0]?.date, value: series[0]?.value },
            last: { date: series.at(-1)?.date, value: series.at(-1)?.value },
          }
        : null;

    const summary =
      stats === null
        ? `No data for ${args.metric} in last ${args.days}d (source=${args.source}).`
        : `${args.metric} over last ${args.days}d (${args.source}): ` +
          `n=${stats.count}, min=${stats.min}, mean=${stats.mean}, max=${stats.max}`;

    return {
      content: [
        textBlock(summary),
        jsonBlock({
          metric: args.metric,
          source: args.source,
          days: args.days,
          since: cutoffDate,
          stats,
          series,
        }),
      ],
    };
  },
};

// --------------------------------------------------------------------------
// Tool 3: get_today_briefing
// --------------------------------------------------------------------------

const GetTodayBriefingInput = z.object({}).strict();

export const getTodayBriefingTool = {
  name: 'get_today_briefing',
  description:
    "Fetch today's Protocol daily briefing (the AI-generated coaching note + " +
    'workout/meals JSON). Returns the recovery_note text, the workout plan JSON, ' +
    'and the meals array. Use this when the user asks "what is on my plan today" / ' +
    '"what did Protocol tell me to do" / "summarize today\'s briefing".',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  zodSchema: GetTodayBriefingInput,
  async run(_args: z.infer<typeof GetTodayBriefingInput>): Promise<ToolResult> {
    const sb = getSupabase();
    // Use the user's local-day proxy: UTC date. The web app's briefing job
    // writes one row per UTC day; matching is good enough for the demo.
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await sb
      .from('daily_briefing')
      .select(
        'date, recovery_note, workout, meals, model, prompt_cache_hit, generated_at, regenerated_at'
      )
      .eq('user_id', PROTOCOL_USER_ID)
      .eq('date', today)
      .maybeSingle();

    if (error) return errorResult(`daily_briefing: ${error.message}`);
    if (!data) {
      return {
        content: [
          textBlock(
            `No briefing for ${today} yet. (Briefings generate on first dashboard view ` +
              `or via the daily 8am UTC cron.)`
          ),
          jsonBlock({ date: today, briefing: null }),
        ],
      };
    }

    const recovery = (data.recovery_note as string) || '(no recovery note)';
    const summary = `Briefing for ${data.date}: ${recovery.slice(0, 140)}${
      recovery.length > 140 ? '…' : ''
    }`;

    return {
      content: [textBlock(summary), jsonBlock({ date: today, briefing: data })],
    };
  },
};

// --------------------------------------------------------------------------
// Tool 4: get_recent_audit
// --------------------------------------------------------------------------

const GetRecentAuditInput = z
  .object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .default(7)
      .describe('How many days back to scan. Default 7, max 30.'),
    action_filter: z
      .string()
      .optional()
      .describe(
        'Optional ILIKE-style prefix on the action column, e.g. "sync." or ' +
          '"sync.garmin". Pass exactly the substring to match.'
      ),
  })
  .strict();

export const getRecentAuditTool = {
  name: 'get_recent_audit',
  description:
    "Latest audit_ledger rows for the user (max 50). Each row records one external " +
    'call or sync attempt: action (e.g. sync.garmin), status (ok/error/retry/skipped), ' +
    'ms_elapsed, rows_affected, error_message. Use this when the user asks "what went ' +
    'wrong with the last sync" / "show me recent activity" / "did anything error today".',
  inputSchema: {
    type: 'object',
    properties: {
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 30,
        default: 7,
        description: 'How many days back to scan. Default 7, max 30.',
      },
      action_filter: {
        type: 'string',
        description:
          'Optional substring filter on the action column (matched as ILIKE %x%).',
      },
    },
    additionalProperties: false,
  },
  zodSchema: GetRecentAuditInput,
  async run(args: z.infer<typeof GetRecentAuditInput>): Promise<ToolResult> {
    const sb = getSupabase();
    const since = new Date(
      Date.now() - args.days * 24 * 60 * 60 * 1000
    ).toISOString();

    // Build filter chain first; only apply order/limit after the optional
    // ilike attaches, since order() returns a transform builder that no
    // longer accepts new filters.
    const base = sb
      .from('audit_ledger')
      .select('id, ts, action, target, purpose, status, ms_elapsed, rows_affected, error_message')
      .eq('user_id', PROTOCOL_USER_ID)
      .gte('ts', since);

    let filtered = base;
    if (args.action_filter && args.action_filter.trim()) {
      // ILIKE %filter% — keep it loose so callers can pass "sync." or "garmin".
      const term = args.action_filter.replace(/[%_]/g, '');
      filtered = base.ilike('action', `%${term}%`);
    }

    const { data, error } = await filtered
      .order('ts', { ascending: false })
      .limit(50);
    if (error) return errorResult(`audit_ledger: ${error.message}`);

    const rows = data ?? [];
    const okCount = rows.filter((r) => r.status === 'ok').length;
    const errCount = rows.filter((r) => r.status === 'error').length;
    const retryCount = rows.filter((r) => r.status === 'retry').length;

    const summary = `Audit (last ${args.days}d${
      args.action_filter ? `, action~"${args.action_filter}"` : ''
    }): ${rows.length} rows · ${okCount} ok · ${errCount} error · ${retryCount} retry`;

    return {
      content: [
        textBlock(summary),
        jsonBlock({
          days: args.days,
          action_filter: args.action_filter ?? null,
          counts: { total: rows.length, ok: okCount, error: errCount, retry: retryCount },
          rows,
        }),
      ],
    };
  },
};

// --------------------------------------------------------------------------
// Registry — used by index.ts
// --------------------------------------------------------------------------

// Each entry pairs the MCP advertisement (name/description/inputSchema) with
// the runtime zod validator and handler. The index just iterates this array.
export const ALL_TOOLS = [
  getDataHealthTool,
  getBiometricsRangeTool,
  getTodayBriefingTool,
  getRecentAuditTool,
] as const;

export type ProtocolTool = (typeof ALL_TOOLS)[number];
