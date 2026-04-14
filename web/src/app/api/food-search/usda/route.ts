import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { FoodProduct } from '@/lib/types/models';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized', results: [] },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { query } = body as { query?: string };

    if (!query) {
      return NextResponse.json(
        { error: 'query is required', results: [] },
        { status: 400 }
      );
    }

    // Read USDA API key from user_settings, fall back to DEMO_KEY
    let apiKey = 'DEMO_KEY';
    const { data: settings } = await supabase
      .from('user_settings')
      .select('usda_api_key')
      .eq('user_id', user.id)
      .single();

    if (settings?.usda_api_key) {
      apiKey = settings.usda_api_key;
    }

    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=15&dataType=Branded,Survey%20(FNDDS)`
    );
    const data = await res.json();

    const results: FoodProduct[] = [];

    if (data.foods && Array.isArray(data.foods)) {
      for (const food of data.foods) {
        const nutrients = (food.foodNutrients ?? []) as Array<{
          nutrientId?: number;
          value?: number;
        }>;

        const findNutrient = (id: number): number => {
          const n = nutrients.find((n) => n.nutrientId === id);
          return n?.value ?? 0;
        };

        const calories = findNutrient(1008);
        const protein = findNutrient(1003);
        const carbs = findNutrient(1005);
        const fat = findNutrient(1004);

        let servingSize = '100g';
        if (food.servingSize && food.servingSizeUnit) {
          servingSize = `${food.servingSize}${food.servingSizeUnit}`;
        }

        results.push({
          name: food.description || food.lowercaseDescription || '',
          brand: food.brandName || food.brandOwner || '',
          barcode: food.gtinUpc || '',
          calories: Math.round(calories),
          protein: Math.round(protein * 10) / 10,
          carbs: Math.round(carbs * 10) / 10,
          fat: Math.round(fat * 10) / 10,
          serving_size: servingSize,
          source: 'usda',
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('USDA search error:', error);
    return NextResponse.json(
      { error: 'Failed to search USDA', results: [] },
      { status: 500 }
    );
  }
}
