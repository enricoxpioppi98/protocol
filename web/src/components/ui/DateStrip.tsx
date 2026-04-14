'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, isToday, isSameDay } from 'date-fns';
import { getWeekDays, getNextWeek, getPrevWeek } from '@/lib/utils/dates';
import { cn } from '@/lib/utils/cn';

interface DateStripProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
}

export function DateStrip({ selectedDate, onSelect }: DateStripProps) {
  const weekDays = getWeekDays(selectedDate);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onSelect(getPrevWeek(selectedDate))}
        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
      >
        <ChevronLeft size={18} />
      </button>

      <div className="flex flex-1 justify-between gap-1">
        {weekDays.map((day) => {
          const isSelected = isSameDay(day, selectedDate);
          const today = isToday(day);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelect(day)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-2 text-xs transition-all',
                isSelected
                  ? 'bg-accent text-white'
                  : today
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:bg-card-hover'
              )}
            >
              <span className="font-medium">{format(day, 'EEE')}</span>
              <span className={cn('text-lg font-bold', !isSelected && !today && 'text-foreground')}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onSelect(getNextWeek(selectedDate))}
        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
