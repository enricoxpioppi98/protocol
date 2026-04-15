import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { name, servingSize } = await request.json();

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Food name is required' }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your-anthropic-api-key-here') {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const serving = servingSize || '1 standard serving';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `Estimate the nutritional values per serving of "${name}".
Serving size: ${serving}.

Return ONLY a valid JSON object with no other text:
{"calories":NUMBER,"protein":NUMBER,"carbs":NUMBER,"fat":NUMBER,"fiber":NUMBER,"serving_size":"STRING"}

Where numbers are rounded to the nearest integer (except protein/carbs/fat/fiber which can have 1 decimal).
serving_size should be like "100g" or "1 cup (240ml)" etc.`,
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      calories: Number(parsed.calories) || 0,
      protein: Number(parsed.protein) || 0,
      carbs: Number(parsed.carbs) || 0,
      fat: Number(parsed.fat) || 0,
      fiber: Number(parsed.fiber) || 0,
      serving_size: String(parsed.serving_size || '1 serving'),
    });
  } catch (error) {
    console.error('AI estimate error:', error);
    return NextResponse.json({ error: 'Failed to estimate nutrition' }, { status: 500 });
  }
}
