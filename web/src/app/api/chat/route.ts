import type Anthropic from '@anthropic-ai/sdk';
import { logAudit } from '@/lib/audit/broker';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';
import { BRIEFING_SYSTEM_PROMPT } from '@/lib/claude/prompts/briefing';
import { CHAT_SYSTEM_ADDENDUM } from '@/lib/claude/prompts/chat';
import { makeSSEStream, SSE_HEADERS } from '@/lib/claude/stream';
import { assembleCoachContext, contextToPromptInput } from '@/lib/coach/context';
import {
  MEAL_TOOL_INPUT_SCHEMA,
  WORKOUT_TOOL_INPUT_SCHEMA,
  validateMealToolInput,
} from '@/lib/coach/types';
import { createClient } from '@/lib/supabase/server';
import type {
  BriefingMeal,
  BriefingWorkout,
  ChatToolCall,
  MealSlot,
} from '@/lib/types/models';

/**
 * POST /api/chat — streaming chat with the regenerate_workout tool.
 *
 * Body: { messages: Array<{role: 'user'|'assistant', content: string}> }
 *
 * Reuses the briefing system prompt + per-user profile cache prefix, then
 * appends a today's-state JSON message and a chat-specific addendum.
 *
 * Tool loop: when Claude emits regenerate_workout(input), we run it
 * (= a focused Claude sub-call returning a workout JSON), persist the new
 * workout to daily_briefing, and feed the result back to Claude as a
 * tool_result. Claude continues with a natural-language explanation. Capped
 * at 3 round-trips so a model loop can't burn tokens forever.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TOOL_ROUNDTRIPS = 3;

interface InboundMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await req.json().catch(() => null)) as
    | { messages?: InboundMessage[] }
    | null;
  const inbound = body?.messages ?? [];
  if (!inbound.length || inbound.at(-1)?.role !== 'user') {
    return new Response(
      JSON.stringify({ error: 'messages must end with a user turn' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Persist the user's turn immediately. Failure here doesn't break chat —
  // we just log and continue so the SSE stream still runs end-to-end.
  const userTurnText = inbound.at(-1)?.content ?? '';
  try {
    await supabase.from('chat_messages').insert({
      user_id: user.id,
      role: 'user',
      content: userTurnText,
      tools: [],
    });
  } catch (err) {
    console.error('[chat] persist user message failed', err);
  }

  // Pass the latest user turn as the recall query so coach memory retrieves
  // semantically-similar past chat / briefing context, not similarity-to-the-
  // biometric-snapshot. Briefing endpoint uses the default synthesized query.
  const ctx = await assembleCoachContext(user.id, {
    recallQuery: userTurnText || undefined,
  });
  const today = ctx.today;

  // Today's briefing (so Claude knows what workout the user is asking to modify).
  const { data: briefingRow } = await supabase
    .from('daily_briefing')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle();

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: BRIEFING_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text:
        'USER_PROFILE (read-only, freeform JSON):\n' +
        JSON.stringify(ctx.profile ?? {}, null, 2),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: CHAT_SYSTEM_ADDENDUM,
    },
    {
      type: 'text',
      text:
        'TODAY_STATE (uncached, current at request time):\n' +
        contextToPromptInput(ctx) +
        '\n\nTODAY_BRIEFING:\n' +
        JSON.stringify(briefingRow ?? null, null, 0),
    },
  ];

  // Convert inbound chat to Anthropic messages format.
  const messages: Anthropic.MessageParam[] = inbound.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const { stream, controller } = makeSSEStream();
  const anthropic = getAnthropic();

  // Run the agent loop in the background; the response returns the SSE stream.
  (async () => {
    let workingMessages = messages;
    // Track today's meals across rounds so multiple swap_meal calls in a single
    // chat turn compose correctly (each swap sees the prior swap's result).
    let currentMeals: BriefingMeal[] = Array.isArray(briefingRow?.meals)
      ? (briefingRow.meals as BriefingMeal[])
      : [];
    // Mirror what the client accumulates so we can persist the assistant turn
    // after the stream ends. `assistantText` collects every text_delta across
    // rounds; `assistantTools` mirrors per-tool status transitions.
    let assistantText = '';
    const assistantTools: ChatToolCall[] = [];
    const setToolStatus = (id: string, status: ChatToolCall['status']) => {
      const t = assistantTools.find((x) => x.id === id);
      if (t) t.status = status;
    };
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDTRIPS; round++) {
        logAudit({
          actor: user.id,
          action: 'claude.messages.stream',
          target: 'api.anthropic.com',
          purpose: round === 0 ? 'chat' : 'chat.tool_continuation',
          ts: new Date().toISOString(),
        });

        const sdkStream = anthropic.messages.stream({
          model: MODEL_SONNET,
          max_tokens: 1024,
          temperature: 0.4,
          system: systemBlocks,
          tools: [
            {
              name: 'regenerate_workout',
              description:
                'Replace today\'s workout with a new one given the user\'s new constraints. ' +
                'Use this whenever the user asks to change today\'s training (shorter, different equipment, swap focus, etc.).',
              input_schema: {
                type: 'object',
                properties: {
                  constraints: {
                    type: 'string',
                    description: 'A short description of what changed (e.g. "only 30 minutes available").',
                  },
                  duration_minutes: {
                    type: 'integer',
                    description: 'Optional: explicit duration cap.',
                  },
                },
                required: ['constraints'],
              } as unknown as Anthropic.Tool.InputSchema,
            },
            {
              name: 'swap_meal',
              description:
                'Swap a single meal at a given slot with a new meal. Use when the user wants to change one meal — different cuisine, different macros, dietary swap, etc.',
              input_schema: {
                type: 'object',
                properties: {
                  slot: {
                    type: 'string',
                    enum: ['breakfast', 'lunch', 'dinner', 'snack'],
                  },
                  reason: {
                    type: 'string',
                    description: 'Why we are swapping (user constraint).',
                  },
                },
                required: ['slot', 'reason'],
              } as unknown as Anthropic.Tool.InputSchema,
            },
          ],
          messages: workingMessages,
        });

        // Track tool-use as it streams, so we can run it after stream ends.
        const pendingTools = new Map<
          string,
          { name: string; jsonAcc: string; index: number }
        >();
        const assistantBlocks: Anthropic.ContentBlock[] = [];

        for await (const evt of sdkStream) {
          if (evt.type === 'content_block_start') {
            if (evt.content_block.type === 'tool_use') {
              pendingTools.set(evt.content_block.id, {
                name: evt.content_block.name,
                jsonAcc: '',
                index: evt.index,
              });
              assistantTools.push({
                id: evt.content_block.id,
                name: evt.content_block.name,
                status: 'pending',
              });
              controller.emit('tool_use_start', {
                id: evt.content_block.id,
                name: evt.content_block.name,
              });
            }
          } else if (evt.type === 'content_block_delta') {
            if (evt.delta.type === 'text_delta') {
              assistantText += evt.delta.text;
              controller.emit('text', { delta: evt.delta.text });
            } else if (evt.delta.type === 'input_json_delta') {
              // Find the tool by index — input_json_delta doesn't carry the id.
              for (const [id, p] of pendingTools) {
                if (p.index === evt.index) {
                  p.jsonAcc += evt.delta.partial_json;
                  controller.emit('tool_input_delta', {
                    id,
                    partial_json: evt.delta.partial_json,
                  });
                  break;
                }
              }
            }
          }
        }

        const finalMessage = await sdkStream.finalMessage();
        for (const block of finalMessage.content) {
          assistantBlocks.push(block);
        }

        if (finalMessage.stop_reason !== 'tool_use') {
          controller.emit('done', {});
          break;
        }

        // Run the tool(s). v1 supports regenerate_workout and swap_meal.
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of finalMessage.content) {
          if (block.type !== 'tool_use') continue;
          if (block.name !== 'regenerate_workout' && block.name !== 'swap_meal') {
            setToolStatus(block.id, 'error');
            controller.emit('tool_result', {
              id: block.id,
              ok: false,
              result: 'unknown tool',
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: 'Unknown tool. Skipping.',
              is_error: true,
            });
            continue;
          }

          setToolStatus(block.id, 'running');
          controller.emit('tool_executing', { id: block.id, name: block.name });

          try {
            if (block.name === 'regenerate_workout') {
              const input = block.input as {
                constraints: string;
                duration_minutes?: number;
              };
              const newWorkout = await regenerateWorkout({
                userId: user.id,
                today,
                ctx,
                previousWorkout: (briefingRow?.workout as BriefingWorkout) ?? null,
                constraints: input.constraints,
                durationMinutes: input.duration_minutes,
              });

              // Persist
              await supabase
                .from('daily_briefing')
                .update({
                  workout: newWorkout,
                  regenerated_at: new Date().toISOString(),
                })
                .eq('user_id', user.id)
                .eq('date', today);

              setToolStatus(block.id, 'success');
              controller.emit('tool_result', {
                id: block.id,
                ok: true,
                result: newWorkout,
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(newWorkout),
              });
            } else {
              // swap_meal
              const input = block.input as {
                slot: MealSlot;
                reason: string;
              };
              const newMeal = await swapMeal({
                userId: user.id,
                today,
                ctx,
                currentMeals,
                slot: input.slot,
                reason: input.reason,
              });

              // Splice the new meal into the meals array. Replace if a meal at
              // that slot exists; otherwise append (e.g. snack added on the fly).
              const existingIdx = currentMeals.findIndex(
                (m) => m.slot === newMeal.slot
              );
              const updatedMeals =
                existingIdx >= 0
                  ? currentMeals.map((m, i) => (i === existingIdx ? newMeal : m))
                  : [...currentMeals, newMeal];
              currentMeals = updatedMeals;

              // Persist
              await supabase
                .from('daily_briefing')
                .update({
                  meals: updatedMeals,
                  regenerated_at: new Date().toISOString(),
                })
                .eq('user_id', user.id)
                .eq('date', today);

              setToolStatus(block.id, 'success');
              controller.emit('tool_result', {
                id: block.id,
                ok: true,
                result: newMeal,
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(newMeal),
              });
            }
          } catch (err) {
            console.error('[chat] tool error', err);
            setToolStatus(block.id, 'error');
            controller.emit('tool_result', {
              id: block.id,
              ok: false,
              result: err instanceof Error ? err.message : 'unknown error',
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: 'Tool failed. Apologize briefly to the user.',
              is_error: true,
            });
          }
        }

        // Continue the loop with the assistant's tool_use turn + tool_result turn.
        workingMessages = [
          ...workingMessages,
          { role: 'assistant', content: assistantBlocks },
          { role: 'user', content: toolResults },
        ];
      }
    } catch (err) {
      console.error('[chat] stream error', err);
      controller.emit('error', {
        message: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      // Fire-and-forget persistence of the assistant turn. Wrapped in try/catch
      // because a DB write failure must not surface to the (already-closed)
      // SSE stream.
      try {
        if (assistantText.length > 0 || assistantTools.length > 0) {
          await supabase.from('chat_messages').insert({
            user_id: user.id,
            role: 'assistant',
            content: assistantText,
            tools: assistantTools,
          });
        }
      } catch (persistErr) {
        console.error('[chat] persist assistant message failed', persistErr);
      }
      controller.close();
    }
  })();

  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Sub-call: ask Claude for a fresh workout JSON given the user's new
 * constraints. Forces the workout schema via tool_choice.
 */
async function regenerateWorkout(args: {
  userId: string;
  today: string;
  ctx: Awaited<ReturnType<typeof assembleCoachContext>>;
  previousWorkout: BriefingWorkout | null;
  constraints: string;
  durationMinutes?: number;
}): Promise<BriefingWorkout> {
  const anthropic = getAnthropic();

  const userMessage = JSON.stringify(
    {
      task: 'regenerate_workout',
      constraints: args.constraints,
      duration_minutes_cap: args.durationMinutes ?? null,
      previous_workout: args.previousWorkout,
      biometrics: args.ctx.biometrics_today,
      goals: args.ctx.profile?.goals ?? null,
      equipment_available: args.ctx.profile?.equipment_available ?? [],
    },
    null,
    0
  );

  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1000,
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: BRIEFING_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'emit_workout',
        description: 'Emit the replacement workout JSON.',
        input_schema: {
          type: 'object',
          properties: {
            workout: WORKOUT_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
          },
          required: ['workout'],
        } as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_workout' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const tool = response.content.find(
    (b): b is Extract<Anthropic.ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
  );
  if (!tool) throw new Error('regenerate_workout returned no tool call');
  const out = tool.input as { workout: BriefingWorkout };
  if (!out.workout || typeof out.workout !== 'object') {
    throw new Error('regenerate_workout returned malformed workout');
  }
  return out.workout;
}

/**
 * Sub-call: ask Claude for a single replacement meal at the given slot, given
 * today's biometrics, the user's profile (especially dietary restrictions),
 * the rest of today's meals, and the user's reason. Forces the meal schema
 * via tool_choice on emit_meal.
 */
async function swapMeal(args: {
  userId: string;
  today: string;
  ctx: Awaited<ReturnType<typeof assembleCoachContext>>;
  currentMeals: BriefingMeal[];
  slot: MealSlot;
  reason: string;
}): Promise<BriefingMeal> {
  const anthropic = getAnthropic();

  const previousMeal =
    args.currentMeals.find((m) => m.slot === args.slot) ?? null;
  const otherMeals = args.currentMeals.filter((m) => m.slot !== args.slot);

  const userMessage = JSON.stringify(
    {
      task: 'swap_meal',
      slot: args.slot,
      reason: args.reason,
      previous_meal: previousMeal,
      other_meals_today: otherMeals,
      biometrics: args.ctx.biometrics_today,
      goals: args.ctx.profile?.goals ?? null,
      dietary_restrictions: args.ctx.profile?.dietary_restrictions ?? [],
    },
    null,
    0
  );

  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1000,
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: BRIEFING_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text:
          `Emit a single replacement meal at slot=${args.slot}. ` +
          `Honor dietary_restrictions strictly. Keep macros sensible for the ` +
          `user's goals and the rest of today's meals. Return only the meal — ` +
          `the caller will splice it into the day.`,
      },
    ],
    tools: [
      {
        name: 'emit_meal',
        description: 'Emit the replacement meal JSON.',
        input_schema: {
          type: 'object',
          properties: {
            meal: MEAL_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
          },
          required: ['meal'],
        } as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_meal' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const tool = response.content.find(
    (b): b is Extract<Anthropic.ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
  );
  if (!tool) throw new Error('swap_meal returned no tool call');
  const out = tool.input as { meal: unknown };
  const meal = validateMealToolInput(out.meal);
  // Force the slot to match what was requested — Claude can drift.
  if (meal.slot !== args.slot) {
    meal.slot = args.slot;
  }
  return meal;
}
