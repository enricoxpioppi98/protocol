'use client';

import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { NutritionLabel } from './NutritionLabel';
import type { FoodProduct, MealType } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';

interface FoodDetailProps {
  food: FoodProduct;
  mealType: MealType;
  onBack: () => void;
  onAdd: (food: FoodProduct, servings: number) => void | Promise<void>;
}

export function FoodDetail({ food, mealType, onBack, onAdd }: FoodDetailProps) {
  const [servings, setServings] = useState(1);
  const [adding, setAdding] = useState(false);

  const cal = food.calories * servings;
  const prot = food.protein * servings;
  const carb = food.carbs * servings;
  const fatVal = food.fat * servings;

  async function handleAdd() {
    if (adding) return;
    setAdding(true);
    await onAdd(food, servings);
    setAdding(false);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 overflow-hidden">
          <h2 className="truncate text-lg font-bold">{food.name}</h2>
          {food.brand && (
            <p className="truncate text-sm text-muted">{food.brand}</p>
          )}
        </div>
      </div>

      {/* Serving info */}
      <div className="rounded-xl bg-card px-4 py-3">
        <div className="text-xs text-muted">Serving size</div>
        <div className="text-sm font-medium">{food.serving_size}</div>
      </div>

      {/* Servings picker */}
      <div>
        <label className="mb-2 block text-sm text-muted">Number of servings</label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setServings(Math.max(0.25, servings - 0.25))}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-lg font-bold text-muted hover:text-foreground"
          >
            -
          </button>
          <input
            type="number"
            value={servings}
            onChange={(e) =>
              setServings(Math.max(0.25, parseFloat(e.target.value) || 0.25))
            }
            step={0.25}
            min={0.25}
            className="w-20 rounded-xl bg-card px-3 py-2 text-center text-lg font-bold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => setServings(servings + 0.25)}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-lg font-bold text-muted hover:text-foreground"
          >
            +
          </button>
        </div>
      </div>

      {/* Live nutrition label */}
      <NutritionLabel calories={cal} protein={prot} carbs={carb} fat={fatVal} />

      {/* Source badge */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 font-medium',
            food.source === 'usda' && 'bg-accent/15 text-accent',
            food.source === 'openfoodfacts' && 'bg-success/15 text-success',
            food.source === 'nutritionix' && 'bg-highlight/15 text-highlight'
          )}
        >
          {food.source === 'usda'
            ? 'USDA'
            : food.source === 'openfoodfacts'
              ? 'OpenFoodFacts'
              : 'Nutritionix'}
        </span>
      </div>

      {/* Add button */}
      <button
        onClick={handleAdd}
        disabled={adding}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-white transition-opacity hover:opacity-90"
      >
        {adding && <Loader2 size={16} className="animate-spin" />}
        Add to {mealType}
      </button>
    </div>
  );
}
