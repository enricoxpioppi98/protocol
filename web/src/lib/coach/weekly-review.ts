import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';

/**
 * Track 25 — weekly review generator.
 *
 * Reads the user's prior 7 days of biometrics, workouts, macros, and recent
 * chat highlights and emits a structured weekly review:
 *   - 3 wins
 *   - 3 concerns
 *   - 1 projection for the upcoming week
 *   - a one-paragraph overall summary
 *
 * Forced tool-use of `emit_weekly_review` keeps the output shape stable.
 * Cap max_tokens around 2000 — the prompt is small, the review is bullet-
 * sized, and we want the model to stay tight.
 */

export interface WeeklyReviewSummary {
  wins: string[];                   // up to 3 short bullets
  concerns: string[];               // up to 3 short bullets
  projection: string;               // 1-2 sentences on the upcoming week
  paragraph: string;                // 3-4 sentence overall summary
  signals_used: string[];           // which signals shaped the review
}

export interface WeeklyReviewInputs {
  user_id: string;
  week_start: string;               // YYYY-MM-DD (Monday)
  week_end: string;                 // YYYY-MM-DD (Sunday)
  // Compact 7-day biometric digest:
  biometrics_7d: Array<{
    date: string;
    sleep_score?: number | null;
    hrv_ms?: number | null;
    resting_hr?: number | null;
    training_load_acute?: number | null;
    total_steps?: number | null;
  }>;
  // Workouts emitted in the prior 7 daily_briefings (name + duration + intensity hint)
  workouts_7d: Array<{ date: string; name: string; duration_minutes: number | null }>;
  // Macro digest (avg per day across the week)
  macro_digest: {
    avg_kcal: number;
    avg_protein_g: number;
    avg_fiber_g: number;
    days_logged: number;
  } | null;
  // Recent chat highlights — last 5-10 user turns
  chat_highlights: string[];
  // Profile snippet for goals
  profile_goals: Record<string, unknown> | null;
}

const SYSTEM = `You are Protocol's weekly coach. Read 7 days of biometrics + workouts + macros + recent chat highlights, emit one structured review.

Goal: read the just-completed week as a coach would, then hand the user three wins, three concerns, and one projection for the next 7 days.

Wins: 3 specific things that improved week-over-week or hit targets. Concerns: 3 specific things that drifted or missed. Projection: one paragraph on what the next 7 days should emphasize given the data.

Be specific. Numbers over adjectives. Reference dates and metrics by name. "Sleep score averaged 78 (up 6 from last week's 72)" — not "sleep was good."

If a signal is missing for the whole week (e.g. no HRV, no logged macros), say so honestly in concerns or the paragraph — don't invent. Phrase as "no HRV captured this week — reconnect Whoop to track recovery trend" not "HRV was stable."

Wins/concerns are short bullets — ≤120 chars each, no leading dash or bullet character. The model emits the strings; the UI renders the dot.

Projection: 1-2 sentences. What should the user emphasize the upcoming week — more rest, more volume, harder cardio, tighter macros? Tie it to the week's signal pattern, not generic advice.

Paragraph: 3-4 sentences. The overall arc of the week — what was the dominant story, what changed, what to carry forward.

signals_used: short comma-separated lowercase descriptors of the signals that shaped the review. Examples: "sleep avg 78", "HRV trend ↓", "5 lifts logged", "macros undisclosed", "chat: hip-flexor mention 2x". Cap at 6 entries.

Output via the emit_weekly_review tool. Never produce free-text.

Edge cases:
- Sparse week (≤2 days of biometrics): say so in concerns ("only 2 days of biometrics — week is hard to read"), still give 3 wins/concerns from whatever did land (workouts, chat).
- No workouts logged: that itself is a concern; projection nudges the user back to the schedule.
- Goals JSON empty: skip macro-target language, don't invent a target.

REMEMBER: emit_weekly_review is your only output. Three wins, three concerns, one projection, one paragraph, signals_used.`;

const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    wins: {
      type: 'array',
      items: { type: 'string', minLength: 3, maxLength: 160 },
      minItems: 1,
      maxItems: 3,
    },
    concerns: {
      type: 'array',
      items: { type: 'string', minLength: 3, maxLength: 160 },
      minItems: 1,
      maxItems: 3,
    },
    projection: { type: 'string', minLength: 10, maxLength: 480 },
    paragraph: { type: 'string', minLength: 20, maxLength: 800 },
    signals_used: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 60 },
      maxItems: 6,
    },
  },
  required: ['wins', 'concerns', 'projection', 'paragraph', 'signals_used'],
};

function buildUserInput(inputs: WeeklyReviewInputs): string {
  return JSON.stringify({
    week_start: inputs.week_start,
    week_end: inputs.week_end,
    biometrics_7d: inputs.biometrics_7d,
    workouts_7d: inputs.workouts_7d,
    macro_digest: inputs.macro_digest,
    chat_highlights: inputs.chat_highlights,
    profile_goals: inputs.profile_goals ?? {},
  });
}

export async function generateWeeklyReview(
  inputs: WeeklyReviewInputs
): Promise<WeeklyReviewSummary> {
  const userInput = buildUserInput(inputs);

  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 2000,
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'emit_weekly_review',
        description:
          'Emit one structured weekly review for the user covering the week_start..week_end window.',
        input_schema: TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_weekly_review' },
    messages: [{ role: 'user', content: userInput }],
  });

  const tool = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );
  if (!tool) {
    throw new Error('emit_weekly_review not called by model');
  }

  return parseWeeklyReviewToolInput(tool.input);
}

/**
 * Validates the tool-use input from Claude into a WeeklyReviewSummary. Strict
 * about types and array shapes; lenient about whitespace + array length (we
 * trim / cap silently rather than 502-ing the whole route).
 */
export function parseWeeklyReviewToolInput(raw: unknown): WeeklyReviewSummary {
  if (!raw || typeof raw !== 'object') {
    throw new Error('emit_weekly_review returned non-object input');
  }
  const input = raw as {
    wins?: unknown;
    concerns?: unknown;
    projection?: unknown;
    paragraph?: unknown;
    signals_used?: unknown;
  };

  const wins = toStringArray(input.wins, 3);
  const concerns = toStringArray(input.concerns, 3);
  const signals_used = toStringArray(input.signals_used, 6);

  if (wins.length === 0) {
    throw new Error('emit_weekly_review returned no wins');
  }
  if (concerns.length === 0) {
    throw new Error('emit_weekly_review returned no concerns');
  }

  const projection =
    typeof input.projection === 'string' ? input.projection.trim() : '';
  const paragraph =
    typeof input.paragraph === 'string' ? input.paragraph.trim() : '';
  if (!projection) {
    throw new Error('emit_weekly_review returned empty projection');
  }
  if (!paragraph) {
    throw new Error('emit_weekly_review returned empty paragraph');
  }

  return {
    wins,
    concerns,
    projection,
    paragraph,
    signals_used,
  };
}

function toStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}

/**
 * Render a WeeklyReviewSummary to a markdown blob for the rendered_md column.
 * The /weekly page renders structured fields directly, but stashing the
 * markdown lets us cheaply expose it in chat / share / email later without
 * re-parsing the JSON.
 */
export function renderWeeklyReviewMarkdown(
  summary: WeeklyReviewSummary,
  inputs: Pick<WeeklyReviewInputs, 'week_start' | 'week_end'>
): string {
  const lines: string[] = [];
  lines.push(`# Weekly review · ${inputs.week_start} → ${inputs.week_end}`);
  lines.push('');
  lines.push(summary.paragraph);
  lines.push('');
  lines.push('## Wins');
  for (const w of summary.wins) lines.push(`- ${w}`);
  lines.push('');
  lines.push('## Concerns');
  for (const c of summary.concerns) lines.push(`- ${c}`);
  lines.push('');
  lines.push('## Projection');
  lines.push(summary.projection);
  if (summary.signals_used.length > 0) {
    lines.push('');
    lines.push(`signals_used: ${summary.signals_used.join(', ')}`);
  }
  return lines.join('\n');
}
