import type { CycleEntry, CyclePhase } from '@/lib/types/models';

/**
 * Pure menstrual-cycle phase computation.
 *
 * Given the user's logged period-start dates, compute today's day-of-cycle
 * (1 = day 1 of menstruation), the corresponding phase, and a forecast of
 * days until the next predicted period start.
 *
 * Strategy:
 *   - 0 entries  → unknown.
 *   - 1 entry    → use the default 28-day cycle length.
 *   - 2+ entries → average the gaps between consecutive starts and use that
 *     as the learned cycle length, clamped to [21, 40] days so an outlier
 *     gap (e.g. illness, hormonal shift) doesn't blow the prediction up.
 *
 * We anchor to the most recent start ON OR BEFORE today. If every logged
 * start is in the future (clock skew, manual mis-entry), we step back by the
 * learned cycle length until we land on a plausible anchor or fall back to
 * `unknown`.
 *
 * Phase ranges follow standard 28-day model (the prompt cites these too):
 *   1-5   menstruation
 *   6-13  follicular
 *   14-16 ovulation
 *   17-28 luteal
 *
 * For learned cycles longer than 28d we still phase off the same fixed
 * windows (so day 17 stays luteal regardless of cycle length). That keeps
 * the model interpretable; cycle-length variation mostly stretches the
 * follicular phase, which our 1-13 / 14-16 / 17-N partition tolerates by
 * assigning days past 28 to luteal until the next start lands.
 */
export interface CyclePhaseResult {
  /** 1-indexed day of cycle. -1 if unknown. */
  day_of_cycle: number;
  phase: CyclePhase;
  /** Days until the next predicted period start. null if unknown. */
  days_until_next: number | null;
}

const DEFAULT_CYCLE_LENGTH = 28;
const MIN_CYCLE_LENGTH = 21;
const MAX_CYCLE_LENGTH = 40;

/**
 * Day index helpers — work entirely in UTC days since epoch so we never
 * trip on DST or local-tz weirdness when subtracting two dates.
 */
function toUtcDay(d: Date): number {
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000
  );
}

function parseDateOnly(yyyymmdd: string): Date | null {
  // Use a YYYY-MM-DDT00:00:00Z anchor so the resulting Date is tz-stable.
  if (!/^\d{4}-\d{2}-\d{2}/.test(yyyymmdd)) return null;
  const d = new Date(`${yyyymmdd.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampCycleLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CYCLE_LENGTH;
  if (n < MIN_CYCLE_LENGTH) return MIN_CYCLE_LENGTH;
  if (n > MAX_CYCLE_LENGTH) return MAX_CYCLE_LENGTH;
  return Math.round(n);
}

function phaseForDay(day: number): CyclePhase {
  if (day < 1) return 'unknown';
  if (day <= 5) return 'menstruation';
  if (day <= 13) return 'follicular';
  if (day <= 16) return 'ovulation';
  return 'luteal';
}

export function computeCyclePhase(
  entries: CycleEntry[],
  today: Date
): CyclePhaseResult {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { day_of_cycle: -1, phase: 'unknown', days_until_next: null };
  }

  // Parse + sort start_dates ascending (oldest first), drop invalid rows.
  const sortedDays: number[] = [];
  for (const e of entries) {
    const d = parseDateOnly(e.start_date);
    if (d) sortedDays.push(toUtcDay(d));
  }
  sortedDays.sort((a, b) => a - b);

  if (sortedDays.length === 0) {
    return { day_of_cycle: -1, phase: 'unknown', days_until_next: null };
  }

  // Learn cycle length from the average gap between consecutive starts.
  let cycleLength = DEFAULT_CYCLE_LENGTH;
  if (sortedDays.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sortedDays.length; i++) {
      const gap = sortedDays[i] - sortedDays[i - 1];
      if (gap >= MIN_CYCLE_LENGTH && gap <= MAX_CYCLE_LENGTH) {
        gaps.push(gap);
      }
    }
    if (gaps.length > 0) {
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      cycleLength = clampCycleLength(avg);
    }
  }

  const todayDay = toUtcDay(today);

  // Anchor: the most recent start on or before today. If none (all logs are
  // in the future), step back by cycle length from the earliest entry.
  let anchor = -Infinity;
  for (const d of sortedDays) {
    if (d <= todayDay && d > anchor) anchor = d;
  }

  if (anchor === -Infinity) {
    // Walk the oldest known start backwards by cycle length until it's <= today.
    let candidate = sortedDays[0];
    while (candidate > todayDay) {
      candidate -= cycleLength;
    }
    if (candidate <= todayDay) {
      anchor = candidate;
    } else {
      return { day_of_cycle: -1, phase: 'unknown', days_until_next: null };
    }
  }

  const dayOfCycle = todayDay - anchor + 1;

  // If the user is overdue (past the predicted next start), the most recent
  // logged start no longer reflects the current cycle — cap the response in
  // that case rather than reporting day_of_cycle 47.
  if (dayOfCycle > cycleLength + 7) {
    return { day_of_cycle: -1, phase: 'unknown', days_until_next: null };
  }

  const daysUntilNext = Math.max(0, cycleLength - dayOfCycle);

  return {
    day_of_cycle: dayOfCycle,
    phase: phaseForDay(dayOfCycle),
    days_until_next: daysUntilNext,
  };
}
