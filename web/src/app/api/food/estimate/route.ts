import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { name, servingSize } = await request.json();

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Food name is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your-gemini-api-key-here') {
      return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const serving = servingSize || '1 standard serving';

    const result = await model.generateContent(
      `Estimate the nutritional values per serving of "${name}".
Serving size: ${serving}.

Return ONLY a valid JSON object with no other text:
{"calories":NUMBER,"protein":NUMBER,"carbs":NUMBER,"fat":NUMBER,"fiber":NUMBER,"serving_size":"STRING"}

Where numbers are rounded to the nearest integer (except protein/carbs/fat/fiber which can have 1 decimal).
serving_size should be like "100g" or "1 cup (240ml)" etc.`
    );

    const text = result.response.text();

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
