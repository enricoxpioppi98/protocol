'use client';

import { Trash2, ChefHat } from 'lucide-react';
import type { Recipe } from '@/lib/types/models';
import {
  recipeCaloriesPerServing,
  recipeProteinPerServing,
  recipeCarbsPerServing,
  recipeFatPerServing,
} from '@/lib/utils/macros';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';

interface RecipeCardProps {
  recipe: Recipe;
  onClick: () => void;
  onDelete: (id: string) => void;
}

export function RecipeCard({ recipe, onClick, onDelete }: RecipeCardProps) {
  const cal = recipeCaloriesPerServing(recipe);
  const protein = recipeProteinPerServing(recipe);
  const carbs = recipeCarbsPerServing(recipe);
  const fat = recipeFatPerServing(recipe);
  const ingredientCount = recipe.ingredients?.length ?? 0;

  return (
    <div
      className="group relative cursor-pointer rounded-2xl bg-card p-4 transition-colors hover:bg-card-hover"
      onClick={onClick}
    >
      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(recipe.id);
        }}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </button>

      {/* Icon + name */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15">
          <ChefHat size={18} className="text-accent" />
        </div>
        <div className="flex-1 pr-6">
          <h3 className="font-semibold leading-tight">{recipe.name}</h3>
          <p className="text-xs text-muted">
            {recipe.servings} serving{recipe.servings !== 1 ? 's' : ''} &middot; {ingredientCount} ingredient{ingredientCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Per-serving macros */}
      <div className="flex justify-between rounded-xl bg-background px-3 py-2.5 text-sm">
        <div className="text-center">
          <div className="font-bold tabular-nums text-highlight">{Math.round(cal)}</div>
          <div className="text-[10px] text-muted">cal</div>
        </div>
        <div className="text-center">
          <div className="font-bold tabular-nums text-accent">{Math.round(protein)}g</div>
          <div className="text-[10px] text-muted">protein</div>
        </div>
        <div className="text-center">
          <div className="font-bold tabular-nums text-highlight">{Math.round(carbs)}g</div>
          <div className="text-[10px] text-muted">carbs</div>
        </div>
        <div className="text-center">
          <div className="font-bold tabular-nums text-fat">{Math.round(fat)}g</div>
          <div className="text-[10px] text-muted">fat</div>
        </div>
      </div>
    </div>
  );
}
