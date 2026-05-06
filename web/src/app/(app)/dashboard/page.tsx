import { DashboardContent } from './DashboardContent';

/**
 * Dashboard route — thin server component.
 *
 * Phase 1 of wave 5 dropped the SyncHealthCard from this page (it confused
 * users into reading "100/100" as "you are healthy" when it actually meant
 * "your data pipeline is healthy"). The card now lives at the top of
 * /settings/integrations where the meaning is unambiguous. Phase 2 mounts a
 * proper Readiness score in this slot.
 */

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return <DashboardContent />;
}
