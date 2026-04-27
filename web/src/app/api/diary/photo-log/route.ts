import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';
import { createClient } from '@/lib/supabase/server';
import { persistMealToDiary, PersistMealError } from '@/lib/diary/persistMeal';
import type { MealType } from '@/lib/types/models';

/**
 * POST /api/diary/photo-log
 *
 * Two-phase endpoint:
 *
 *  Phase 1 — analyze (default).  Body: multipart/form-data with
 *    - file: a single image (jpeg / png / webp), <= 5 MB
 *    - meal_type (optional): 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks'
 *    Sends the image to Claude with a forced `emit_meal` tool call. Returns
 *    the parsed meal WITHOUT persisting:
 *      { ok: true, phase: 'analyze', meal_name, items: [{food, grams}], macros }
 *    On parse failure: retries once at temp 0; if that still fails, 502.
 *
 *  Phase 2 — commit. Body: multipart/form-data with
 *    - meal_type (optional)
 *    - items_json: JSON-encoded { name, items: [{food, grams}], macros }
 *    Skips Claude and persists the supplied (possibly user-edited) meal as a
 *    Recipe + diary_entry. Returns:
 *      { ok: true, phase: 'commit', recipe_id, diary_entry_id, meal_name,
 *        items: [{food, grams, calories, protein, carbs, fat}], macros, foods_created }
 *
 * The split lets the modal show an editable result before persistence —
 * "Cancel" in the modal simply doesn't make the commit call, so no rows
 * are written.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VALID_MEAL_TYPES = new Set<MealType>(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);

const PHOTO_LOG_SYSTEM_PROMPT = `You are a nutrition expert reading a single photograph of a meal. Identify
the visible foods and estimate quantities + macros conservatively. Prefer
specific names ("grilled chicken breast" not "chicken"). When unsure of
quantity, lean toward smaller estimates. Output only via the emit_meal tool.`;

const EMIT_MEAL_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'A short human-readable name for the whole meal, e.g. "Grilled chicken bowl".',
    },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          food: { type: 'string', description: 'Specific food name, e.g. "grilled chicken breast".' },
          grams: { type: 'number', description: 'Estimated weight in grams.' },
        },
        required: ['food', 'grams'],
      },
    },
    macros: {
      type: 'object',
      properties: {
        kcal: { type: 'number' },
        p: { type: 'number', description: 'Protein in grams.' },
        c: { type: 'number', description: 'Carbohydrates in grams.' },
        f: { type: 'number', description: 'Fat in grams.' },
      },
      required: ['kcal', 'p', 'c', 'f'],
    },
  },
  required: ['name', 'items', 'macros'],
} as const;

interface ParsedMeal {
  name: string;
  items: Array<{ food: string; grams: number }>;
  macros: { kcal: number; p: number; c: number; f: number };
}

function todayLocalISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateEmitMealInput(value: unknown): ParsedMeal {
  if (!value || typeof value !== 'object') {
    throw new Error('emit_meal input is not an object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || v.name.trim().length === 0) {
    throw new Error('meal.name must be a non-empty string');
  }
  if (!Array.isArray(v.items) || v.items.length === 0) {
    throw new Error('meal.items must be a non-empty array');
  }
  const items: Array<{ food: string; grams: number }> = [];
  for (const raw of v.items) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('meal.items entry is not an object');
    }
    const it = raw as Record<string, unknown>;
    if (typeof it.food !== 'string' || it.food.trim().length === 0) {
      throw new Error('meal.items[].food must be a non-empty string');
    }
    if (typeof it.grams !== 'number' || !Number.isFinite(it.grams) || it.grams <= 0) {
      throw new Error('meal.items[].grams must be a positive number');
    }
    items.push({ food: it.food.trim(), grams: it.grams });
  }
  if (!v.macros || typeof v.macros !== 'object') {
    throw new Error('meal.macros missing');
  }
  const m = v.macros as Record<string, unknown>;
  if (
    typeof m.kcal !== 'number' ||
    typeof m.p !== 'number' ||
    typeof m.c !== 'number' ||
    typeof m.f !== 'number'
  ) {
    throw new Error('meal.macros must contain numeric kcal, p, c, f');
  }
  return {
    name: v.name.trim(),
    items,
    macros: { kcal: m.kcal, p: m.p, c: m.c, f: m.f },
  };
}

async function callClaudeOnce(args: {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<ParsedMeal> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1024,
    temperature: 0,
    system: PHOTO_LOG_SYSTEM_PROMPT,
    tools: [
      {
        name: 'emit_meal',
        description:
          'Emit a single structured meal identified from the photo, with items and total macros.',
        input_schema: EMIT_MEAL_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_meal' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: args.mediaType, data: args.base64 },
          },
          {
            type: 'text',
            text: 'Identify the meal in this photo. Estimate macros conservatively. Output only via the emit_meal tool.',
          },
        ],
      },
    ],
  });

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );
  if (!toolBlock) {
    throw new Error('model returned no tool call');
  }
  return validateEmitMealInput(toolBlock.input);
}

function parseItemsJson(raw: string): ParsedMeal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('items_json is not valid JSON');
  }
  return validateEmitMealInput(value);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  // Resolve meal_type (default Lunch).
  const rawMealType = form.get('meal_type');
  const mealType: MealType =
    typeof rawMealType === 'string' && VALID_MEAL_TYPES.has(rawMealType as MealType)
      ? (rawMealType as MealType)
      : 'Lunch';

  // Branch 1: client supplied edited items — skip Claude, just persist.
  const itemsJsonRaw = form.get('items_json');
  if (typeof itemsJsonRaw === 'string' && itemsJsonRaw.trim().length > 0) {
    let parsed: ParsedMeal;
    try {
      parsed = parseItemsJson(itemsJsonRaw);
    } catch (err) {
      return NextResponse.json(
        { error: 'invalid items_json', detail: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
    try {
      const result = await persistMealToDiary({
        supabase,
        userId: user.id,
        meal: parsed,
        date: todayLocalISO(),
        mealType,
      });
      return NextResponse.json({
        ok: true,
        phase: 'commit',
        recipe_id: result.recipe_id,
        diary_entry_id: result.diary_entry_id,
        meal_name: parsed.name,
        items: result.items.map((it) => ({
          food: it.food,
          grams: it.grams,
          calories: it.calories,
          protein: it.protein,
          carbs: it.carbs,
          fat: it.fat,
        })),
        macros: parsed.macros,
        foods_created: result.foods_created,
      });
    } catch (err) {
      if (err instanceof PersistMealError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error('[photo-log] persist (edited) failed', err);
      return NextResponse.json({ error: 'failed to log meal' }, { status: 500 });
    }
  }

  // Phase 1: analyze only — image -> Claude -> return parsed meal (no DB writes).
  const fileRaw = form.get('file');
  if (!(fileRaw instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  const file = fileRaw;

  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file too large (max 5 MB)' },
      { status: 413 }
    );
  }

  const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp';
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return NextResponse.json(
      { error: 'unsupported media type (jpeg / png / webp only)' },
      { status: 415 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString('base64');

  let parsed: ParsedMeal;
  try {
    parsed = await callClaudeOnce({ base64, mediaType });
  } catch (err) {
    const firstErrMsg = err instanceof Error ? err.message : String(err);
    console.warn('[photo-log] first Claude attempt failed, retrying', firstErrMsg);
    try {
      parsed = await callClaudeOnce({ base64, mediaType });
    } catch (err2) {
      const detail = err2 instanceof Error ? err2.message : String(err2);
      console.error('[photo-log] retry also failed', detail);
      return NextResponse.json(
        { error: 'could not parse meal', detail },
        { status: 502 }
      );
    }
  }

  // Edge: Claude returned a meal with no items. The schema enforces minItems=1
  // but defend in depth — never let an empty meal hit the persistence layer.
  if (parsed.items.length === 0) {
    return NextResponse.json(
      { error: 'could not parse meal', detail: 'model returned no items' },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    phase: 'analyze',
    meal_name: parsed.name,
    items: parsed.items,
    macros: parsed.macros,
  });
}
