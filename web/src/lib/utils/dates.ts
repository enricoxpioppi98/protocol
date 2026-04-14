import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
  isSameDay,
  parseISO,
} from 'date-fns';

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatDisplayDate(date: Date): string {
  if (isToday(date)) return 'Today';
  return format(date, 'EEE, MMM d');
}

export function getWeekDays(referenceDate: Date): Date[] {
  const start = startOfWeek(referenceDate, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function getNextWeek(referenceDate: Date): Date {
  return addWeeks(referenceDate, 1);
}

export function getPrevWeek(referenceDate: Date): Date {
  return subWeeks(referenceDate, 1);
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function calculateStreak(entryDates: string[]): number {
  // entryDates are 'YYYY-MM-DD' strings
  // Count consecutive days going backwards from today
  const uniqueDates = new Set(entryDates);
  const today = new Date();
  let streak = 0;

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    if (uniqueDates.has(dateStr)) {
      streak++;
    } else if (i === 0) {
      // Today has no entries yet — check from yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}

export { isToday, isSameDay, parseISO, format };
