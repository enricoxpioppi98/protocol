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

    // Read Nutritionix credentials from user_settings
    const { data: settings } = await supabase
      .from('user_settings')
      .select('nutritionix_app_id, nutritionix_app_key')
      .eq('user_id', user.id)
      .single();

    if (!settings?.nutritionix_app_id || !settings?.nutritionix_app_key) {
      return NextResponse.json({
        error: 'Nutritionix not configured',
        results: [],
      });
    }

    const res = await fetch(
      `https://trackapi.nutritionix.com/v2/search/instant?query=${encodeURIComponent(query)}&branded=true`,
      {
        headers: {
          'x-app-id': settings.nutritionix_app_id,
          'x-app-key': settings.nutritionix_app_key,
        },
      }
    );
    const data = await res.json();

    const results: FoodProduct[] = [];

    if (data.branded && Array.isArray(data.branded)) {
      for (const item of data.branded) {
        const servingQty = item.serving_qty ?? 1;
        const servingUnit = item.serving_unit ?? 'serving';

        results.push({
          name: item.food_name || '',
          brand: item.brand_name || '',
          barcode: '',
          calories: Math.round(item.nf_calories ?? 0),
          protein: Math.round((item.nf_protein ?? 0) * 10) / 10,
          carbs: Math.round((item.nf_total_carbohydrate ?? 0) * 10) / 10,
          fat: Math.round((item.nf_total_fat ?? 0) * 10) / 10,
          fiber: Math.round((item.nf_dietary_fiber ?? 0) * 10) / 10,
          serving_size: `${servingQty} ${servingUnit}`,
          source: 'nutritionix',
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Nutritionix search error:', error);
    return NextResponse.json(
      { error: 'Failed to search Nutritionix', results: [] },
      { status: 500 }
    );
  }
}
