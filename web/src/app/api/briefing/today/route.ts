import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';
import { BRIEFING_SYSTEM_PROMPT } from '@/lib/claude/prompts/briefing';
import { logAudit } from '@/lib/audit/broker';
import { assembleCoachContext, contextToPromptInput } from '@/lib/coach/context';
import {
  BRIEFING_TOOL_INPUT_SCHEMA,
  validateBriefingToolInput,
} from '@/lib/coach/types';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/briefing/today
 *
 * Returns the user's daily briefing. Idempotent: if a row exists for today,
 * returns it as-is. Pass `?regenerate=1` to force a fresh call.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('regenerate') === '1';

  const today = new Date().toISOString().slice(0, 10);

  // Idempotency: return existing briefing unless ?regenerate=1.
  if (!force) {
    const { data: existing } = await supabase
      .from('daily_briefing')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ briefing: existing, cached: true });
    }
  }

  // Build the per-request context.
  const ctx = await assembleCoachContext(user.id);
  const userInput = contextToPromptInput(ctx);

  // Cached system prompt (head) + cached per-user profile addendum (tail).
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

  const anthropic = getAnthropic();

  logAudit({
    actor: user.id,
    action: 'claude.messages.create',
    target: 'api.anthropic.com',
    purpose: 'briefing',
    ts: new Date().toISOString(),
  });

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 2000,
      temperature: 0.3,
      system: systemBlocks,
      tools: [
        {
          name: 'emit_briefing',
          description: 'Emit the structured daily briefing.',
          input_schema: BRIEFING_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_briefing' },
      messages: [{ role: 'user', content: userInput }],
    });
  } catch (err) {
    console.error('[briefing] anthropic error', err);
    return NextResponse.json(
      { error: 'coaching unavailable, please retry' },
      { status: 502 }
    );
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );
  if (!toolBlock) {
    return NextResponse.json(
      { error: 'model returned no tool call' },
      { status: 502 }
    );
  }

  let parsed;
  try {
    parsed = validateBriefingToolInput(toolBlock.input);
  } catch (err) {
    console.error('[briefing] validation error', err, toolBlock.input);
    return NextResponse.json(
      { error: 'model returned malformed briefing' },
      { status: 502 }
    );
  }

  const cacheHit =
    (response.usage?.cache_read_input_tokens ?? 0) > 0 ||
    (response.usage?.cache_creation_input_tokens ?? 0) > 0;

  const upsertPayload = {
    user_id: user.id,
    date: today,
    meals: parsed.meals,
    workout: parsed.workout,
    recovery_note: parsed.recovery_note,
    model: MODEL_SONNET,
    prompt_cache_hit: cacheHit,
    generated_at: new Date().toISOString(),
    regenerated_at: force ? new Date().toISOString() : null,
  };

  const { data: row, error: upsertErr } = await supabase
    .from('daily_briefing')
    .upsert(upsertPayload, { onConflict: 'user_id,date' })
    .select('*')
    .single();

  if (upsertErr) {
    console.error('[briefing] upsert error', upsertErr);
    return NextResponse.json({ error: 'failed to persist briefing' }, { status: 500 });
  }

  return NextResponse.json({ briefing: row, cached: false });
}
