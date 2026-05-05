import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';
import type { CoachContext } from './context';

/**
 * Wave 4: morning coach checkin generator.
 *
 * One question per day. The point isn't conversation — it's filling the gap
 * between what sensors can measure (HRV, sleep score, training load) and
 * what only the user knows (subjective soreness, life stress, last night's
 * dinner, whether the hip is still bothering them). Answers feed back into
 * the next briefing regen as a `chat_message`, so the coach's plan adapts.
 */

export interface MorningQuestion {
  /** The question itself, ≤200 chars. */
  question: string;
  /** 0-3 short tappable replies, each ≤24 chars. Empty when free-text wins. */
  quick_replies: string[];
  /** Internal reasoning the coach used to pick the question. Not shown. */
  rationale: string;
}

const SYSTEM = `You are Protocol's morning coach. Given the user's current biometrics, anomalies, recall, genome flags, yesterday's workout, and recent training pattern, generate ONE high-leverage question to ask the user this morning.

Goal: collect a single piece of info the sensors can't measure that will let you tune today's plan.

Examples:
- Yesterday was heavy lower-body → "Quads on a 1-10?"  quick_replies: ["Fresh", "Tight", "Sore"]
- HRV anomalously low → "HRV is unusually low (38 vs 62 baseline). Anything stressful — short sleep, alcohol, work pressure?"  quick_replies: ["Sleep", "Alcohol", "Work", "Nothing"]
- Recall surfaces past hip-pain mention on a similar HRV-drop day → "Last time HRV dropped this hard was 04/12 — you mentioned hip pain. How's the hip today?"  quick_replies: ["Fine", "A bit tight", "Same as before"]
- Unremarkable day → "Any travel or dinner plans tonight that should shift today's calorie target?"  quick_replies: ["No", "Dinner out"]

Rules:
- ONE question only. Tight (≤200 chars).
- 0-3 quick_replies, each ≤24 chars. If a free-text answer is clearly more useful (e.g. asking what's hurting), return [].
- Don't ask about something already in the data (no "how was your sleep?" if sleep_score is in biometrics).
- Don't ask "how do you feel today?" — too open. Tie to a specific signal: an anomaly, a past_context excerpt, or yesterday's workout.
- Honor genome_flags when relevant (e.g. for a CYP1A2 slow user: "Caffeine timing today — last cup before noon?").
- If past_context contains a specific date / phrase, anchor the question to it ("on 04/12 you said …").
- The rationale field: one sentence on which signal drove the question. For your debug logs only.

Output via the emit_morning_question tool. Never produce free-text.`;

const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    question: { type: 'string', minLength: 5, maxLength: 220 },
    quick_replies: {
      type: 'array',
      items: { type: 'string', maxLength: 28 },
      maxItems: 3,
    },
    rationale: { type: 'string', maxLength: 240 },
  },
  required: ['question', 'quick_replies', 'rationale'],
};

export async function generateMorningQuestion(
  ctx: CoachContext
): Promise<MorningQuestion> {
  // Compact context payload — the question generator doesn't need the full
  // briefing context. We emphasize the signals that drive question choice.
  const userInput = JSON.stringify({
    today: ctx.today,
    biometrics: ctx.biometrics_today
      ? {
          sleep_score: ctx.biometrics_today.sleep_score,
          hrv_ms: ctx.biometrics_today.hrv_ms,
          resting_hr: ctx.biometrics_today.resting_hr,
          training_load_acute: ctx.biometrics_today.training_load_acute,
          source: ctx.biometrics_today.source,
        }
      : null,
    trends: ctx.trends,
    anomalies: ctx.anomalies.map((a) => ({
      metric: a.metric_label,
      today: a.today_value,
      baseline_median: a.baseline_median,
      direction: a.direction,
      severity: a.severity,
      similar_past: a.similar_past.slice(0, 1).map((p) => ({
        date: p.date,
        value: p.value,
      })),
    })),
    yesterday_workout: ctx.yesterday_workout
      ? {
          name: ctx.yesterday_workout.name,
          duration_minutes: ctx.yesterday_workout.duration_minutes,
        }
      : null,
    recent_pattern: ctx.recent_workouts_summary.workout_pattern,
    past_context: ctx.recall.slice(0, 2).map((r) => ({
      ts: r.ts,
      age_days: r.age_days,
      excerpt: r.content.slice(0, 240),
    })),
    genome_flag_categories: ctx.genome_flags.map((g) => g.category),
  });

  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 400,
    temperature: 0.4,
    system: [
      {
        type: 'text',
        text: SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'emit_morning_question',
        description: 'Emit one high-leverage morning question for the user.',
        input_schema: TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_morning_question' },
    messages: [{ role: 'user', content: userInput }],
  });

  const tool = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );
  if (!tool) {
    throw new Error('emit_morning_question not called by model');
  }
  const input = tool.input as {
    question?: unknown;
    quick_replies?: unknown;
    rationale?: unknown;
  };
  if (typeof input.question !== 'string' || !input.question.trim()) {
    throw new Error('emit_morning_question returned empty question');
  }
  const replies = Array.isArray(input.quick_replies)
    ? input.quick_replies
        .filter((r): r is string => typeof r === 'string')
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .slice(0, 3)
    : [];
  return {
    question: input.question.trim(),
    quick_replies: replies,
    rationale:
      typeof input.rationale === 'string' ? input.rationale.trim() : '',
  };
}
