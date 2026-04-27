'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { RecipeEditor } from '@/components/recipe/RecipeEditor';
import { useRecipes } from '@/lib/hooks/useRecipes';

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    recipes,
    loading,
    updateRecipe,
    addIngredient,
    removeIngredient,
    updateIngredientQuantity,
  } = useRecipes();

  const recipe = recipes.find((r) => r.id === id);
  const ingredientCount = recipe?.ingredients?.length ?? 0;

  return (
    <div className="space-y-5">
      <Link
        href="/recipes"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        Recipes
      </Link>

      {loading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {!loading && !recipe && (
        <>
          <header className="animate-[fadeIn_0.4s_ease-out]">
            <div className="eyebrow text-accent">Recipe</div>
            <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
              Not <span className="italic text-muted">found</span>
            </h1>
          </header>
          <div className="glass flex flex-col items-center gap-2 rounded-2xl px-6 py-12 text-center">
            <p className="font-serif text-xl text-foreground">Recipe not found</p>
            <p className="text-sm text-muted">This recipe may have been deleted.</p>
            <button
              onClick={() => router.push('/recipes')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/90 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent"
            >
              Back to library
            </button>
          </div>
        </>
      )}

      {!loading && recipe && (
        <>
          <header className="animate-[fadeIn_0.4s_ease-out]">
            <div className="flex items-center gap-3 animate-[fadeIn_0.5s_ease-out_0.05s_both]">
              <div className="eyebrow text-accent">Recipe</div>
              <div className="h-px flex-1 bg-border" />
              <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
                {recipe.servings.toString().padStart(2, '0')} svg
                {' · '}
                {ingredientCount.toString().padStart(2, '0')} ing
              </div>
            </div>
            <h1 className="mt-3 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px] animate-[fadeIn_0.5s_ease-out_0.1s_both]">
              {recipe.name}
            </h1>
          </header>

          <RecipeEditor
            recipe={recipe}
            onUpdateRecipe={updateRecipe}
            onAddIngredient={addIngredient}
            onRemoveIngredient={removeIngredient}
            onUpdateIngredientQuantity={updateIngredientQuantity}
          />
        </>
      )}
    </div>
  );
}
