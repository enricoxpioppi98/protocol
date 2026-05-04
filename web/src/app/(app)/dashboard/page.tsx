import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { DataHealthCard } from '@/components/dashboard/DataHealthCard';
import { DashboardContent } from './DashboardContent';

/**
 * Dashboard route — thin async server component.
 *
 * The previous incarnation was a client component that did all of its data
 * loading client-side. Track 5 (data-health-score) added a server-rendered
 * <DataHealthCard /> at the top of the page; the rest of the dashboard's
 * interactive body now lives in <DashboardContent />, which we mount as a
 * client child below. The split keeps the score visible immediately on first
 * paint without waiting for a JS hydrate + RPC roundtrip.
 *
 * Auth: this page sits inside `(app)/layout.tsx` which is a client layout —
 * unauthenticated users normally never reach it because middleware redirects
 * them at the route level. We still null-check `user` so we don't 500 if the
 * cookie races; without a user we just render the client body (which has its
 * own RLS-scoped fetches that will return empty).
 */

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The score card needs a user_id to query against. If we don't have one
  // (e.g. middleware miss or logged-out preview), skip the card entirely
  // rather than throwing — the rest of the dashboard still renders.
  const healthSlot = user ? (
    <Suspense fallback={<DataHealthSkeleton />}>
      <DataHealthCard userId={user.id} />
    </Suspense>
  ) : null;

  return <DashboardContent headerSlot={healthSlot} />;
}

function DataHealthSkeleton() {
  return (
    <div
      className="glass rounded-2xl p-5 opacity-60"
      aria-busy="true"
      aria-label="Loading data health"
    >
      <div className="eyebrow">Data health</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-serif text-5xl tabular-nums text-muted/40">
          —
        </span>
        <span className="font-mono text-xs tabular-nums text-muted/40">
          / 100
        </span>
      </div>
      <p className="mt-2 text-xs text-muted/60">checking sources…</p>
    </div>
  );
}
