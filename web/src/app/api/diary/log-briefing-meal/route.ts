import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { persistMealToDiary, PersistMealError } from '@/lib/diary/persistMeal';
import type { BriefingMeal, MealSlot, MealType } from '@/lib/types/models';

/**
 * POST /api/diary/log-briefing-meal
 *
 * Body: { briefing_date: string (YYYY-MM-DD), meal_index: number }
 *
 * Logs an AI-generated briefing meal to the user's diary as a Recipe so the
 * diary shows ONE row per meal (instead of 4-6 separate food rows).
 *
 * Persistence (find-or-create Food + Recipe + diary_entry) lives in
 * `@/lib/diary/persistMeal` and is shared with `/api/diary/photo-log`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LogBriefingMealBody {
  briefing_date?: unknown;
  meal_index?: unknown;
}

const SLOT_TO_MEAL_TYPE: Record<MealSlot, MealType> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s).getTime();
  return !Number.isNaN(t);
}

function todayLocalISO(): string {
  // Mirrors briefing/today/route.ts so meal log dates align with briefing keys.
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as LogBriefingMealBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const briefingDate = typeof body.briefing_date === 'string' ? body.briefing_date.trim() : '';
  const mealIndex = typeof body.meal_index === 'number' ? body.meal_index : -1;

  if (!briefingDate || !isValidDate(briefingDate)) {
    return NextResponse.json(
      { error: 'briefing_date must be YYYY-MM-DD' },
      { status: 400 }
    );
  }
  if (!Number.isInteger(mealIndex) || mealIndex < 0) {
    return NextResponse.json(
      { error: 'meal_index must be a non-negative integer' },
      { status: 400 }
    );
  }

  const { data: briefing, error: briefingErr } = await supabase
    .from('daily_briefing')
    .select('meals')
    .eq('user_id', user.id)
    .eq('date', briefingDate)
    .maybeSingle();

  if (briefingErr) {
    console.error('[log-briefing-meal] briefing fetch error', briefingErr);
    return NextResponse.json({ error: 'failed to load briefing' }, { status: 500 });
  }
  if (!briefing) {
    return NextResponse.json({ error: 'briefing not found' }, { status: 404 });
  }

  const meals = (briefing.meals ?? []) as BriefingMeal[];
  if (!Array.isArray(meals) || mealIndex >= meals.length) {
    return NextResponse.json({ error: 'meal not found' }, { status: 404 });
  }

  const meal = meals[mealIndex];
  if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
    return NextResponse.json({ error: 'meal has no items' }, { status: 400 });
  }

  const slot = meal.slot;
  const mealType = SLOT_TO_MEAL_TYPE[slot];
  if (!mealType) {
    return NextResponse.json({ error: 'meal has invalid slot' }, { status: 400 });
  }

  try {
    const result = await persistMealToDiary({
      supabase,
      userId: user.id,
      meal: { name: meal.name, items: meal.items, macros: meal.macros },
      date: todayLocalISO(),
      mealType,
    });

    return NextResponse.json({
      ok: true,
      recipe_id: result.recipe_id,
      diary_entry_id: result.diary_entry_id,
      meal_type: mealType,
      foods_created: result.foods_created,
    });
  } catch (err) {
    if (err instanceof PersistMealError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[log-briefing-meal] unexpected error', err);
    return NextResponse.json({ error: 'failed to log meal' }, { status: 500 });
  }
}
