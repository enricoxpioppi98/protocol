'use client';

import { useRouter } from 'next/navigation';
import { ChefHat, Plus } from 'lucide-react';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { useRecipes } from '@/lib/hooks/useRecipes';

export default function RecipesPage() {
  const router = useRouter();
  const { recipes, loading, createRecipe, deleteRecipe } = useRecipes();

  async function handleNewRecipe() {
    const recipe = await createRecipe('New Recipe', 1);
    if (recipe) {
      router.push(`/recipes/${recipe.id}`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recipes</h1>
        <button
          onClick={handleNewRecipe}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus size={16} />
          New Recipe
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && recipes.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-card py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15">
            <ChefHat size={32} className="text-accent" />
          </div>
          <div className="text-center">
            <p className="font-semibold">No recipes yet</p>
            <p className="mt-1 text-sm text-muted">
              Create your first recipe to track homemade meals.
            </p>
          </div>
          <button
            onClick={handleNewRecipe}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus size={16} />
            Create Recipe
          </button>
        </div>
      )}

      {/* Recipe grid */}
      {!loading && recipes.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onClick={() => router.push(`/recipes/${recipe.id}`)}
              onDelete={deleteRecipe}
            />
          ))}
        </div>
      )}
    </div>
  );
}
