/**
 * Schemas for AI-emitted briefing output. Used both as Claude tool input_schema
 * (so Claude is forced to produce well-formed JSON) and as runtime validators
 * before we persist to Supabase.
 *
 * We avoid Zod here to keep dependencies tight in v1 — Claude's tool-use
 * already constrains shape; we add a thin runtime guard so a malformed payload
 * surfaces a clear error instead of corrupting the daily_briefing row.
 */

import type { BriefingMeal, BriefingWorkout } from '@/lib/types/models';

export interface BriefingToolInput {
  meals: BriefingMeal[];
  workout: BriefingWorkout;
  recovery_note: string;
}

// JSONSchema fragment passed to Claude as the emit_briefing tool's input_schema.
export const BRIEFING_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    meals: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          name: { type: 'string', description: 'e.g. "Greek yogurt + oats + blueberries"' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                food: { type: 'string' },
                grams: { type: 'number' },
              },
              required: ['food', 'grams'],
            },
          },
          macros: {
            type: 'object',
            properties: {
              kcal: { type: 'number' },
              p: { type: 'number' },
              c: { type: 'number' },
              f: { type: 'number' },
            },
            required: ['kcal', 'p', 'c', 'f'],
          },
        },
        required: ['slot', 'name', 'items', 'macros'],
      },
    },
    workout: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "Push day — chest/shoulder/tri" or "5K tempo"' },
        duration_minutes: { type: 'integer' },
        blocks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              sets: { type: 'integer' },
              reps: { type: 'string', description: 'e.g. "8-10", "5x", "3 min"' },
              intensity: { type: 'string', description: 'e.g. "RPE 8", "Z2", "85% 1RM"' },
              notes: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
      required: ['name', 'duration_minutes', 'blocks'],
    },
    recovery_note: {
      type: 'string',
      description: '1-2 sentences. Connect today\'s biometrics to today\'s plan.',
    },
  },
  required: ['meals', 'workout', 'recovery_note'],
} as const;

export function validateBriefingToolInput(value: unknown): BriefingToolInput {
  if (!value || typeof value !== 'object') {
    throw new Error('briefing tool input is not an object');
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.meals) || v.meals.length < 3) {
    throw new Error('briefing.meals must be an array of >= 3');
  }
  if (!v.workout || typeof v.workout !== 'object') {
    throw new Error('briefing.workout missing');
  }
  if (typeof v.recovery_note !== 'string') {
    throw new Error('briefing.recovery_note must be a string');
  }
  return value as BriefingToolInput;
}

// Workout-only schema for the regenerate_workout tool result.
export const WORKOUT_TOOL_INPUT_SCHEMA = BRIEFING_TOOL_INPUT_SCHEMA.properties.workout;
