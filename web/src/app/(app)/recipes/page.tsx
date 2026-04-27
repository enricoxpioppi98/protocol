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
      <header className="mb-2 animate-[fadeIn_0.4s_ease-out]">
        <div className="flex items-center gap-3 animate-[fadeIn_0.5s_ease-out_0.05s_both]">
          <div className="eyebrow text-accent">Library</div>
          <div className="h-px flex-1 bg-border" />
          <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
            {recipes.length.toString().padStart(2, '0')} saved
          </div>
        </div>

        <h1 className="mt-3 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px] animate-[fadeIn_0.5s_ease-out_0.1s_both]">
          Recipes
        </h1>

        <div className="mt-3 flex items-end justify-between gap-3 animate-[fadeIn_0.5s_ease-out_0.18s_both]">
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Your reusable meals. Build once, log in seconds.
          </p>
          <button
            onClick={handleNewRecipe}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent"
          >
            <Plus size={14} />
            New recipe
          </button>
        </div>
      </header>

      {loading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {!loading && recipes.length === 0 && (
        <div className="glass flex flex-col items-center gap-4 rounded-2xl py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15">
            <ChefHat size={28} className="text-accent" />
          </div>
          <div className="text-center">
            <p className="font-serif text-xl text-foreground">No recipes yet</p>
            <p className="mt-1 text-sm text-muted">
              Create your first recipe to track homemade meals.
            </p>
          </div>
          <button
            onClick={handleNewRecipe}
            className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/90 px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent"
          >
            <Plus size={14} />
            Create recipe
          </button>
        </div>
      )}

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
