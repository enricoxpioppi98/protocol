import { NextRequest, NextResponse } from 'next/server';
import type { FoodProduct } from '@/lib/types/models';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, barcode } = body as { query?: string; barcode?: string };

    if (!query && !barcode) {
      return NextResponse.json(
        { error: 'query or barcode is required', results: [] },
        { status: 400 }
      );
    }

    let results: FoodProduct[] = [];

    if (barcode) {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`
      );
      const data = await res.json();

      if (data.status === 1 && data.product) {
        const product = parseProduct(data.product);
        if (product) results = [product];
      }
    } else if (query) {
      const res = await fetch(
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=15`
      );
      const data = await res.json();

      if (data.products && Array.isArray(data.products)) {
        results = data.products
          .map(parseProduct)
          .filter((p: FoodProduct | null): p is FoodProduct => p !== null);
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('OpenFoodFacts search error:', error);
    return NextResponse.json(
      { error: 'Failed to search OpenFoodFacts', results: [] },
      { status: 500 }
    );
  }
}

function parseProduct(product: Record<string, unknown>): FoodProduct | null {
  const name = (product.product_name as string) || '';
  if (!name) return null;

  const nutriments = (product.nutriments ?? {}) as Record<string, unknown>;

  const calories = toNumber(nutriments['energy-kcal_serving']) ??
    toNumber(nutriments['energy-kcal_100g']) ?? 0;
  const protein = toNumber(nutriments['proteins_serving']) ??
    toNumber(nutriments['proteins_100g']) ?? 0;
  const carbs = toNumber(nutriments['carbohydrates_serving']) ??
    toNumber(nutriments['carbohydrates_100g']) ?? 0;
  const fat = toNumber(nutriments['fat_serving']) ??
    toNumber(nutriments['fat_100g']) ?? 0;

  const servingSize = (product.serving_size as string) || '100g';

  return {
    name,
    brand: (product.brands as string) || '',
    barcode: (product.code as string) || '',
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    serving_size: servingSize,
    source: 'openfoodfacts',
  };
}

function toNumber(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}
