'use client';

import { Suspense, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { FoodSearchPanel } from '@/components/food/FoodSearchPanel';
import { FoodDetail } from '@/components/food/FoodDetail';
import { CreateFoodForm } from '@/components/food/CreateFoodForm';
import { createClient } from '@/lib/supabase/client';
import type { FoodProduct, MealType } from '@/lib/types/models';

type View = 'search' | 'detail' | 'create';

function FoodSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mealType = (searchParams.get('meal') as MealType) || 'Breakfast';
  const dateParam = searchParams.get('date') || new Date().toISOString();

  const [view, setView] = useState<View>('search');
  const [selectedFood, setSelectedFood] = useState<FoodProduct | null>(null);

  const supabase = createClient();

  function handleSelect(food: FoodProduct) {
    setSelectedFood(food);
    setView('detail');
  }

  function handleBackToSearch() {
    setSelectedFood(null);
    setView('search');
  }

  const handleAdd = useCallback(
    async (food: FoodProduct, servings: number) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // First, upsert the food into the foods table so we have a food_id
      const { data: existingFoods } = await supabase
        .from('foods')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', food.name)
        .eq('brand', food.brand)
        .is('deleted_at', null)
        .limit(1);

      let foodId: string;

      if (existingFoods && existingFoods.length > 0) {
        foodId = existingFoods[0].id;
      } else {
        // Parse serving size into number + unit
        const sizeMatch = food.serving_size.match(/^([\d.]+)\s*(.*)$/);
        const servingSizeNum = sizeMatch ? parseFloat(sizeMatch[1]) || 1 : 1;
        const servingUnit = sizeMatch ? sizeMatch[2].trim() || 'serving' : 'serving';

        const { data: newFood, error } = await supabase
          .from('foods')
          .insert({
            user_id: user.id,
            name: food.name,
            brand: food.brand,
            barcode: food.barcode,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            serving_size: servingSizeNum,
            serving_unit: servingUnit,
            is_custom: false,
            is_favorite: false,
          })
          .select('id')
          .single();

        if (error || !newFood) return;
        foodId = newFood.id;
      }

      // Format the date as YYYY-MM-DD
      const dateObj = new Date(dateParam);
      const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

      // Create the diary entry
      await supabase.from('diary_entries').insert({
        user_id: user.id,
        date: dateStr,
        meal_type: mealType,
        number_of_servings: servings,
        food_id: foodId,
        recipe_id: null,
      });

      router.push('/diary');
    },
    [supabase, dateParam, mealType, router]
  );

  function handleFoodCreated() {
    setView('search');
  }

  return (
    <div className="space-y-4">
      {view === 'search' && (
        <header className="animate-[fadeIn_0.4s_ease-out]">
          <button
            onClick={() => router.push('/diary')}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-foreground"
          >
            <ChevronLeft size={14} />
            Diary
          </button>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="eyebrow text-accent">Add to</span>
            <h1 className="font-serif text-2xl tracking-tight text-foreground">
              {mealType}
            </h1>
          </div>
        </header>
      )}

      {view === 'search' && (
        <div className="glass rounded-2xl p-4">
          <FoodSearchPanel
            onSelect={handleSelect}
            onCreateCustom={() => setView('create')}
          />
        </div>
      )}

      {view === 'detail' && selectedFood && (
        <FoodDetail
          food={selectedFood}
          mealType={mealType}
          onBack={handleBackToSearch}
          onAdd={handleAdd}
        />
      )}

      {view === 'create' && (
        <CreateFoodForm
          onBack={handleBackToSearch}
          onCreated={handleFoodCreated}
        />
      )}
    </div>
  );
}

export default function FoodSearchPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    }>
      <FoodSearchContent />
    </Suspense>
  );
}
