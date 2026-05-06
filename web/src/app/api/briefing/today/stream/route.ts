import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { logAudit } from '@/lib/audit/broker';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';
import { BRIEFING_SYSTEM_PROMPT } from '@/lib/claude/prompts/briefing';
import { makeSSEStream, SSE_HEADERS } from '@/lib/claude/stream';
import { assembleCoachContext, contextToPromptInput } from '@/lib/coach/context';
import {
  BRIEFING_TOOL_INPUT_SCHEMA,
  validateBriefingToolInput,
} from '@/lib/coach/types';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/briefing/today/stream
 *
 * Streaming twin of /api/briefing/today. Same prompt, same forced-tool-use,
 * same persistence — but the server forwards `input_json_delta` events to
 * the client as Claude builds up the structured briefing JSON. The client
 * extracts `recovery_note` from the partial and renders it token-by-token,
 * giving the dashboard a "live coach typing" feel that matches the chat UX.
 *
 * Always regenerates (no idempotency check) — the streaming endpoint is the
 * regen path. The plain JSON endpoint stays around for the cron-style
 * "generate-if-missing" lookups.
 *
 * SSE event vocabulary (matches lib/claude/stream.ts):
 *   - tool_input_delta : { partial_json: string }    — partial tool-call JSON
 *   - briefing         : { briefing: row }           — final persisted row
 *   - error            : { message: string }
 *   - done             : {}                          — terminal
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  void req;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const ctx = await assembleCoachContext(user.id);
  const userInput = contextToPromptInput(ctx);

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
  ];

  const { stream, controller } = makeSSEStream();
  const anthropic = getAnthropic();

  logAudit({
    actor: user.id,
    action: 'claude.messages.stream',
    target: 'api.anthropic.com',
    purpose: 'briefing.stream',
    ts: new Date().toISOString(),
  });

  // Run the stream + persistence in the background. The SSE response body
  // returns immediately; the controller handle is what the bg task feeds.
  (async () => {
    try {
      const sdkStream = anthropic.messages.stream({
        model: MODEL_SONNET,
        max_tokens: 2000,
        temperature: 0.3,
        system: systemBlocks,
        tools: [
          {
            name: 'emit_briefing',
            description: 'Emit the structured daily briefing.',
            input_schema:
              BRIEFING_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_briefing' },
        messages: [{ role: 'user', content: userInput }],
      });

      let toolBlockIndex: number | null = null;

      for await (const evt of sdkStream) {
        if (evt.type === 'content_block_start') {
          if (evt.content_block.type === 'tool_use') {
            toolBlockIndex = evt.index;
          }
        } else if (evt.type === 'content_block_delta') {
          if (evt.delta.type === 'input_json_delta' && evt.index === toolBlockIndex) {
            controller.emit('tool_input_delta', {
              partial_json: evt.delta.partial_json,
            });
          }
        }
      }

      const finalMessage = await sdkStream.finalMessage();
      const toolBlock = finalMessage.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        controller.emit('error', { message: 'model returned no tool call' });
        controller.emit('done', {});
        controller.close();
        return;
      }

      let parsed;
      try {
        parsed = validateBriefingToolInput(toolBlock.input);
      } catch (err) {
        console.error('[briefing/stream] validation error', err, toolBlock.input);
        controller.emit('error', { message: 'model returned malformed briefing' });
        controller.emit('done', {});
        controller.close();
        return;
      }

      const cacheHit =
        (finalMessage.usage?.cache_read_input_tokens ?? 0) > 0 ||
        (finalMessage.usage?.cache_creation_input_tokens ?? 0) > 0;

      const upsertPayload = {
        user_id: user.id,
        date: today,
        meals: parsed.meals,
        workout: parsed.workout,
        recovery_note: parsed.recovery_note,
        model: MODEL_SONNET,
        prompt_cache_hit: cacheHit,
        generated_at: new Date().toISOString(),
        regenerated_at: new Date().toISOString(),
      };

      const { data: row, error: upsertErr } = await supabase
        .from('daily_briefing')
        .upsert(upsertPayload, { onConflict: 'user_id,date' })
        .select('*')
        .single();

      if (upsertErr) {
        console.error('[briefing/stream] upsert error', upsertErr);
        controller.emit('error', { message: 'failed to persist briefing' });
        controller.emit('done', {});
        controller.close();
        return;
      }

      controller.emit('briefing', { briefing: row });
      controller.emit('done', {});
      controller.close();
    } catch (err) {
      console.error('[briefing/stream] anthropic error', err);
      controller.emit('error', {
        message: err instanceof Error ? err.message : 'streaming failed',
      });
      controller.emit('done', {});
      controller.close();
    }
  })();

  return new Response(stream, { headers: SSE_HEADERS });
}
