import { WeeklyContent } from './WeeklyContent';

/**
 * Track 25 — weekly review page.
 *
 * Server component shell so the route renders deterministically, with the
 * interactive history strip + week switching delegated to a client child.
 * Mirrors the dashboard's thin-server / fat-client split.
 */

export const dynamic = 'force-dynamic';

export default function WeeklyPage() {
  return <WeeklyContent />;
}
