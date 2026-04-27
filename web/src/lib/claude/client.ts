import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// Pinned in one place so the briefing endpoint, the chat endpoint, and the
// regenerate_workout sub-call all use the same model.
export const MODEL_SONNET = 'claude-sonnet-4-6';
