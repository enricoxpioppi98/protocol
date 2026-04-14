'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Food, FoodProduct } from '@/lib/types/models';

export interface SearchResults {
  local: FoodProduct[];
  nutritionix: FoodProduct[];
  usda: FoodProduct[];
  openfoodfacts: FoodProduct[];
}

const emptyResults: SearchResults = {
  local: [],
  nutritionix: [],
  usda: [],
  openfoodfacts: [],
};

export function useFoods() {
  const [favorites, setFavorites] = useState<Food[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResults>(emptyResults);
  const [searching, setSearching] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch favorites on mount
  const fetchFavorites = useCallback(async () => {
    setFavoritesLoading(true);
    const { data, error } = await supabase
      .from('foods')
      .select('*')
      .eq('is_favorite', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (!error && data) {
      setFavorites(data as Food[]);
    }
    setFavoritesLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  // Search foods across all sources
  const searchFoods = useCallback(
    (query: string) => {
      // Clear pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!query.trim()) {
        setSearchResults(emptyResults);
        setSearching(false);
        return;
      }

      setSearching(true);

      debounceRef.current = setTimeout(async () => {
        const trimmed = query.trim();

        // Fire all searches in parallel
        const [localResult, nutritionixResult, usdaResult, offResult] =
          await Promise.allSettled([
            // Local Supabase search
            supabase
              .from('foods')
              .select('*')
              .is('deleted_at', null)
              .ilike('name', `%${trimmed}%`)
              .limit(15)
              .then(({ data }) =>
                (data ?? []).map(
                  (f: Food): FoodProduct => ({
                    name: f.name,
                    brand: f.brand,
                    barcode: f.barcode,
                    calories: f.calories,
                    protein: f.protein,
                    carbs: f.carbs,
                    fat: f.fat,
                    serving_size: `${f.serving_size} ${f.serving_unit}`,
                    source: 'openfoodfacts' as const, // placeholder, overridden below
                  })
                )
              ),
            // Nutritionix
            fetch('/api/food-search/nutritionix', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: trimmed }),
            }).then((r) => r.json()),
            // USDA
            fetch('/api/food-search/usda', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: trimmed }),
            }).then((r) => r.json()),
            // OpenFoodFacts
            fetch('/api/food-search/openfoodfacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: trimmed }),
            }).then((r) => r.json()),
          ]);

        setSearchResults({
          local:
            localResult.status === 'fulfilled'
              ? (localResult.value as FoodProduct[])
              : [],
          nutritionix:
            nutritionixResult.status === 'fulfilled'
              ? (nutritionixResult.value.results ?? [])
              : [],
          usda:
            usdaResult.status === 'fulfilled'
              ? (usdaResult.value.results ?? [])
              : [],
          openfoodfacts:
            offResult.status === 'fulfilled'
              ? (offResult.value.results ?? [])
              : [],
        });

        setSearching(false);
      }, 400);
    },
    [supabase]
  );

  // Create a custom food
  const createFood = useCallback(
    async (food: Omit<Food, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('foods')
        .insert({
          user_id: user.id,
          ...food,
        })
        .select()
        .single();

      if (!error && data) {
        return data as Food;
      }
      return null;
    },
    [supabase]
  );

  // Toggle favorite status
  const toggleFavorite = useCallback(
    async (id: string, currentlyFavorite: boolean) => {
      const { error } = await supabase
        .from('foods')
        .update({ is_favorite: !currentlyFavorite })
        .eq('id', id);

      if (!error) {
        fetchFavorites();
      }
    },
    [supabase, fetchFavorites]
  );

  return {
    favorites,
    favoritesLoading,
    searchResults,
    searching,
    searchFoods,
    createFood,
    toggleFavorite,
    clearResults: () => setSearchResults(emptyResults),
  };
}
