'use client';

import { Flame } from 'lucide-react';
import { getGreeting } from '@/lib/utils/dates';

interface StreakBannerProps {
  streak: number;
  calories: number;
  calorieGoal: number;
}

export function StreakBanner({ streak, calories, calorieGoal }: StreakBannerProps) {
  const greeting = getGreeting();
  const progress = calorieGoal > 0 ? calories / calorieGoal : 0;

  let message = "Let's start tracking!";
  if (progress >= 1) {
    message = 'Goal reached! Great job today.';
  } else if (progress >= 0.75) {
    message = "Almost there, keep it up!";
  } else if (progress >= 0.5) {
    message = "You're halfway there!";
  } else if (progress > 0) {
    message = "Good start, keep going!";
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-xl font-bold">{greeting}</h2>
        <p className="text-sm text-muted">{message}</p>
      </div>
      {streak > 0 && (
        <div className="flex items-center gap-1.5 rounded-xl bg-highlight/15 px-3 py-1.5">
          <Flame size={16} className="text-highlight" />
          <span className="text-sm font-bold text-highlight">{streak}</span>
        </div>
      )}
    </div>
  );
}
