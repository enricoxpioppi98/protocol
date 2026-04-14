import type { MealType } from '@/lib/types/models';

export const mealTypeConfig: Record<MealType, { icon: string; label: string }> = {
  Breakfast: { icon: 'Sunrise', label: 'Breakfast' },
  Lunch: { icon: 'Sun', label: 'Lunch' },
  Dinner: { icon: 'Moon', label: 'Dinner' },
  Snacks: { icon: 'Cookie', label: 'Snacks' },
};
