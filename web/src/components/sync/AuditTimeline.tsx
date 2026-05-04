'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

/**
 * Live audit timeline for the sync dashboard. Receives the initial slice
 * from the server, then subscribes to `audit_ledger` INSERTs filtered to the
 * current user. New rows prepend; the list caps at 20 to keep the DOM tidy
 * and avoid a memory creep on long sessions.
 *
 * The dashboard page already does the `daily_briefing` realtime dance — this
 * follows the same pattern (postgres_changes channel + filter).
 */

export type AuditRow = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  purpose: string;
  status: 'ok' | 'error' | 'retry' | 'skipped' | string;
  ms_elapsed: number | null;
  rows_affected: number | null;
  error_message: string | null;
};

interface Props {
  userId: string;
  initialRows: AuditRow[];
}

const MAX_ROWS = 20;

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  ok: {
    label: 'ok',
    className: 'border-fiber/30 bg-fiber-light text-fiber',
  },
  error: {
    label: 'error',
    className: 'border-danger/30 bg-danger/10 text-danger',
  },
  retry: {
    label: 'retry',
    className: 'border-highlight/30 bg-highlight-light text-highlight',
  },
  skipped: {
    label: 'skipped',
    className: 'border-border bg-glass-2 text-muted',
  },
};

function sourceFromAction(action: string): string {
  // "sync.garmin.success" → "garmin"
  const m = /^sync\.([a-z0-9_-]+)/i.exec(action);
  if (m) return m[1];
  // fall back to the first dotted segment
  return action.split('.')[0] ?? action;
}

export function AuditTimeline({ userId, initialRows }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AuditRow[]>(() => initialRows.slice(0, MAX_ROWS));

  useEffect(() => {
    // Subscribe to INSERTs filtered server-side by user_id so we never see
    // other users' audit rows even if RLS were misconfigured.
    const ch = supabase
      .channel('audit_ledger:user')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_ledger',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as AuditRow;
          setRows((cur) => {
            // Drop dupes (the server slice may already include this row if a
            // sync started before mount).
            if (cur.some((r) => r.id === row.id)) return cur;
            const next = [row, ...cur];
            return next.slice(0, MAX_ROWS);
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, userId]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-glass-1 p-4 text-center text-xs text-muted">
        No sync activity yet. Hit “Sync now” on a connected source above to
        kick off the first run.
      </div>
    );
  }

  return (
    <ol className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border bg-glass-1">
      {rows.map((r, i) => {
        const style =
          STATUS_STYLE[r.status] ??
          { label: r.status || 'unknown', className: 'border-border bg-glass-2 text-muted' };
        const source = sourceFromAction(r.action);
        const ts = safeRelative(r.ts);
        const ms = r.ms_elapsed != null ? `${r.ms_elapsed}ms` : '—';
        return (
          <li
            key={r.id}
            className={cn(
              'flex flex-wrap items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-glass-2',
              i === 0 && 'animate-[fadeIn_0.3s_ease-out]'
            )}
            title={r.error_message ?? r.action}
          >
            <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.18em] text-muted/70">
              {ts}
            </span>
            <span className="rounded-full border border-border bg-glass-2 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground">
              {source}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]',
                style.className
              )}
            >
              · {style.label}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted">
              {ms}
            </span>
            {r.rows_affected != null ? (
              <span className="font-mono text-[10px] tabular-nums text-muted/70">
                · {r.rows_affected} row{r.rows_affected === 1 ? '' : 's'}
              </span>
            ) : null}
            {r.error_message ? (
              <span className="min-w-0 flex-1 truncate text-xs text-danger/80">
                {r.error_message}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted/50">
                {r.action}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function safeRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}
