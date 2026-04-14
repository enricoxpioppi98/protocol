'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
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

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        onClick={() => router.push('/recipes')}
        className="flex items-center gap-1.5 text-sm text-accent transition-colors hover:opacity-80"
      >
        <ArrowLeft size={16} />
        Back to Recipes
      </button>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {/* Not found */}
      {!loading && !recipe && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card py-16">
          <p className="font-semibold">Recipe not found</p>
          <p className="text-sm text-muted">This recipe may have been deleted.</p>
        </div>
      )}

      {/* Editor */}
      {!loading && recipe && (
        <RecipeEditor
          recipe={recipe}
          onUpdateRecipe={updateRecipe}
          onAddIngredient={addIngredient}
          onRemoveIngredient={removeIngredient}
          onUpdateIngredientQuantity={updateIngredientQuantity}
        />
      )}
    </div>
  );
}
