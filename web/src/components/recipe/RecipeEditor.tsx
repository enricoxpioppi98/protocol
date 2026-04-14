'use client';

import { useState, useCallback } from 'react';
import { Plus, Trash2, Search, X } from 'lucide-react';
import type { Recipe, Food } from '@/lib/types/models';
import {
  recipeCaloriesPerServing,
  recipeProteinPerServing,
  recipeCarbsPerServing,
  recipeFatPerServing,
  recipeTotalCalories,
} from '@/lib/utils/macros';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';
import { createClient } from '@/lib/supabase/client';

interface RecipeEditorProps {
  recipe: Recipe;
  onUpdateRecipe: (id: string, updates: Partial<Pick<Recipe, 'name' | 'servings'>>) => void;
  onAddIngredient: (recipeId: string, foodId: string, quantity: number) => void;
  onRemoveIngredient: (ingredientId: string) => void;
  onUpdateIngredientQuantity: (ingredientId: string, quantity: number) => void;
}

export function RecipeEditor({
  recipe,
  onUpdateRecipe,
  onAddIngredient,
  onRemoveIngredient,
  onUpdateIngredientQuantity,
}: RecipeEditorProps) {
  const [name, setName] = useState(recipe.name);
  const [servings, setServings] = useState(recipe.servings);
  const [showSearch, setShowSearch] = useState(false);

  const cal = recipeCaloriesPerServing(recipe);
  const protein = recipeProteinPerServing(recipe);
  const carbs = recipeCarbsPerServing(recipe);
  const fat = recipeFatPerServing(recipe);
  const totalCal = recipeTotalCalories(recipe);
  const ingredients = recipe.ingredients ?? [];

  function handleNameBlur() {
    if (name.trim() && name !== recipe.name) {
      onUpdateRecipe(recipe.id, { name: name.trim() });
    }
  }

  function handleServingsBlur() {
    const val = Math.max(1, servings);
    if (val !== recipe.servings) {
      onUpdateRecipe(recipe.id, { servings: val });
    }
  }

  function handleAddFood(food: Food) {
    onAddIngredient(recipe.id, food.id, 1);
    setShowSearch(false);
  }

  return (
    <div className="space-y-5">
      {/* Name field */}
      <div>
        <label className="mb-2 block text-sm text-muted">Recipe Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="w-full rounded-xl bg-card px-4 py-3 text-lg font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Recipe name"
        />
      </div>

      {/* Servings field */}
      <div>
        <label className="mb-2 block text-sm text-muted">Servings</label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const val = Math.max(1, servings - 1);
              setServings(val);
              onUpdateRecipe(recipe.id, { servings: val });
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-lg font-bold text-muted hover:text-foreground"
          >
            -
          </button>
          <input
            type="number"
            value={servings}
            onChange={(e) => setServings(Math.max(1, parseInt(e.target.value) || 1))}
            onBlur={handleServingsBlur}
            min={1}
            className="w-20 rounded-xl bg-card px-3 py-2 text-center text-lg font-bold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => {
              const val = servings + 1;
              setServings(val);
              onUpdateRecipe(recipe.id, { servings: val });
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-lg font-bold text-muted hover:text-foreground"
          >
            +
          </button>
        </div>
      </div>

      {/* Per-serving nutrition */}
      <div className="rounded-2xl bg-card p-4">
        <h4 className="mb-3 text-sm font-medium text-muted">Per Serving</h4>
        <div className="flex justify-between text-sm">
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
        <div className="mt-2 text-center text-xs text-muted">
          Total: {Math.round(totalCal)} cal
        </div>
      </div>

      {/* Ingredients list */}
      <div className="rounded-2xl bg-card">
        <div className="flex items-center justify-between px-4 py-3">
          <h4 className="font-semibold">
            Ingredients{' '}
            <span className="text-sm font-normal text-muted">({ingredients.length})</span>
          </h4>
        </div>

        {ingredients.length > 0 && (
          <div className="border-t border-border">
            {ingredients.map((ing) => {
              const ingCal = (ing.food?.calories ?? 0) * ing.quantity;
              const ingP = (ing.food?.protein ?? 0) * ing.quantity;
              const ingC = (ing.food?.carbs ?? 0) * ing.quantity;
              const ingF = (ing.food?.fat ?? 0) * ing.quantity;

              return (
                <div
                  key={ing.id}
                  className="group flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">{ing.food?.name ?? 'Unknown'}</span>
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <span className="tabular-nums">{Math.round(ingCal)} cal</span>
                      <MacroPill value={ingP} color={colors.accent} />
                      <MacroPill value={ingC} color={colors.highlight} />
                      <MacroPill value={ingF} color={colors.fat} />
                    </div>
                  </div>

                  {/* Quantity control */}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={ing.quantity}
                      onChange={(e) => {
                        const val = Math.max(0.25, parseFloat(e.target.value) || 0.25);
                        onUpdateIngredientQuantity(ing.id, val);
                      }}
                      step={0.25}
                      min={0.25}
                      className="w-16 rounded-lg bg-background px-2 py-1.5 text-center text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <span className="text-xs text-muted">
                      {ing.food?.serving_unit ?? 'srv'}
                    </span>
                    <button
                      onClick={() => onRemoveIngredient(ing.id)}
                      className="ml-1 rounded-lg p-1.5 text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {ingredients.length === 0 && (
          <div className="border-t border-border px-4 py-8 text-center text-sm text-muted">
            No ingredients yet. Add some below.
          </div>
        )}

        {/* Add ingredient button */}
        <button
          onClick={() => setShowSearch(true)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm text-accent transition-colors hover:bg-accent/5"
        >
          <Plus size={16} />
          Add Ingredient
        </button>
      </div>

      {/* Inline food search panel */}
      {showSearch && (
        <FoodSearchPanel
          onSelect={handleAddFood}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}

function MacroPill({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {Math.round(value)}
    </span>
  );
}

// Inline food search since FoodSearchPanel may not exist yet
interface FoodSearchPanelProps {
  onSelect: (food: Food) => void;
  onClose: () => void;
}

function FoodSearchPanel({ onSelect, onClose }: FoodSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[]>([]);
  const [searching, setSearching] = useState(false);
  const supabase = createClient();

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);

      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .is('deleted_at', null)
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(20);

      if (!error && data) {
        setResults(data as Food[]);
      }
      setSearching(false);
    },
    [supabase]
  );

  // Debounced search
  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      const timeout = setTimeout(() => search(value), 300);
      return () => clearTimeout(timeout);
    },
    [search]
  );

  return (
    <div className="rounded-2xl bg-card">
      {/* Search header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Search size={16} className="text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search foods..."
          autoFocus
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
        />
        <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover">
          <X size={16} />
        </button>
      </div>

      {/* Results */}
      {(results.length > 0 || searching) && (
        <div className="max-h-64 overflow-y-auto border-t border-border">
          {searching && results.length === 0 && (
            <div className="flex justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}
          {results.map((food) => (
            <button
              key={food.id}
              onClick={() => onSelect(food)}
              className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-card-hover"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{food.name}</span>
                {food.brand && (
                  <span className="text-[11px] text-muted">{food.brand}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs tabular-nums text-muted">{Math.round(food.calories)} cal</span>
                <MacroPill value={food.protein} color={colors.accent} />
                <MacroPill value={food.carbs} color={colors.highlight} />
                <MacroPill value={food.fat} color={colors.fat} />
              </div>
            </button>
          ))}
        </div>
      )}

      {query && !searching && results.length === 0 && (
        <div className="border-t border-border px-4 py-6 text-center text-sm text-muted">
          No foods found for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
