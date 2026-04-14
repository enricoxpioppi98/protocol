'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Recipe } from '@/lib/types/models';

export function useRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const fetchRecipes = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from('recipes')
      .select('*, ingredients:recipe_ingredients(*, food:foods(*))')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRecipes(data as Recipe[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('recipes_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recipes' },
        () => { fetchRecipes(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recipe_ingredients' },
        () => { fetchRecipes(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchRecipes]);

  const createRecipe = useCallback(
    async (name: string, servings: number): Promise<Recipe | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('recipes')
        .insert({ user_id: user.id, name, servings })
        .select('*, ingredients:recipe_ingredients(*, food:foods(*))')
        .single();

      if (!error && data) {
        setRecipes((prev) => [data as Recipe, ...prev]);
        return data as Recipe;
      }
      return null;
    },
    [supabase]
  );

  const updateRecipe = useCallback(
    async (id: string, updates: Partial<Pick<Recipe, 'name' | 'servings'>>) => {
      const { error } = await supabase
        .from('recipes')
        .update(updates)
        .eq('id', id);

      if (!error) fetchRecipes();
    },
    [supabase, fetchRecipes]
  );

  const deleteRecipe = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('recipes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        setRecipes((prev) => prev.filter((r) => r.id !== id));
      }
    },
    [supabase]
  );

  const addIngredient = useCallback(
    async (recipeId: string, foodId: string, quantity: number) => {
      const { error } = await supabase
        .from('recipe_ingredients')
        .insert({ recipe_id: recipeId, food_id: foodId, quantity });

      if (!error) fetchRecipes();
    },
    [supabase, fetchRecipes]
  );

  const removeIngredient = useCallback(
    async (ingredientId: string) => {
      const { error } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('id', ingredientId);

      if (!error) fetchRecipes();
    },
    [supabase, fetchRecipes]
  );

  const updateIngredientQuantity = useCallback(
    async (ingredientId: string, quantity: number) => {
      const { error } = await supabase
        .from('recipe_ingredients')
        .update({ quantity })
        .eq('id', ingredientId);

      if (!error) fetchRecipes();
    },
    [supabase, fetchRecipes]
  );

  return {
    recipes,
    loading,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    addIngredient,
    removeIngredient,
    updateIngredientQuantity,
    refetch: fetchRecipes,
  };
}
