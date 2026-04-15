'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Star, Loader2, Clipboard, Check } from 'lucide-react';
import { useFoods, type SearchResults } from '@/lib/hooks/useFoods';
import type { Food, FoodProduct } from '@/lib/types/models';
import { cn } from '@/lib/utils/cn';

interface FoodSearchPanelProps {
  onSelect: (food: FoodProduct) => void;
  onCreateCustom: () => void;
}

export function FoodSearchPanel({ onSelect, onCreateCustom }: FoodSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const { favorites, favoritesLoading, searchResults, searching, searchFoods } = useFoods();

  useEffect(() => {
    searchFoods(query);
  }, [query, searchFoods]);

  const hasQuery = query.trim().length > 0;
  const hasResults =
    searchResults.local.length > 0 ||
    searchResults.nutritionix.length > 0 ||
    searchResults.usda.length > 0 ||
    searchResults.openfoodfacts.length > 0;

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Search foods..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className="w-full rounded-xl bg-card py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {searching && (
          <Loader2
            size={16}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-muted"
          />
        )}
      </div>

      {/* Create custom food button */}
      <button
        onClick={onCreateCustom}
        className="flex w-full items-center gap-2.5 rounded-xl bg-card px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-card-hover"
      >
        <Plus size={18} />
        Create Custom Food
      </button>

      {/* Favorites section (shown when no query) */}
      {!hasQuery && (
        <ResultSection
          title="Favorites"
          icon={<Star size={14} className="text-highlight" />}
          loading={favoritesLoading}
        >
          {favorites.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted">
              No favorites yet. Star foods to add them here.
            </p>
          ) : (
            favorites.map((food) => (
              <FoodRow
                key={food.id}
                food={foodToProduct(food)}
                onSelect={onSelect}
              />
            ))
          )}
        </ResultSection>
      )}

      {/* Search results */}
      {hasQuery && !searching && !hasResults && (
        <p className="py-8 text-center text-sm text-muted">
          No results found for &quot;{query}&quot;
        </p>
      )}

      {hasQuery && searchResults.local.length > 0 && (
        <ResultSection title="My Foods">
          {searchResults.local.map((food, i) => (
            <FoodRow key={`local-${i}`} food={food} onSelect={onSelect} />
          ))}
        </ResultSection>
      )}

      {hasQuery && searchResults.nutritionix.length > 0 && (
        <ResultSection title="Nutritionix">
          {searchResults.nutritionix.map((food, i) => (
            <FoodRow key={`nix-${i}`} food={food} onSelect={onSelect} />
          ))}
        </ResultSection>
      )}

      {hasQuery && searchResults.usda.length > 0 && (
        <ResultSection title="USDA">
          {searchResults.usda.map((food, i) => (
            <FoodRow key={`usda-${i}`} food={food} onSelect={onSelect} />
          ))}
        </ResultSection>
      )}

      {hasQuery && searchResults.openfoodfacts.length > 0 && (
        <ResultSection title="OpenFoodFacts">
          {searchResults.openfoodfacts.map((food, i) => (
            <FoodRow key={`off-${i}`} food={food} onSelect={onSelect} />
          ))}
        </ResultSection>
      )}

      {/* Copy prompt for Claude fallback */}
      {hasQuery && !searching && (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-xs text-muted">Can&apos;t find what you&apos;re looking for?</p>
          <button
            onClick={() => {
              const prompt = `What are the approximate nutritional values per serving of "${query.trim()}"?\nPlease format as:\nFood: [name]\nServing: [amount]\nCalories: [X]\nProtein: [X]g\nCarbs: [X]g\nFat: [X]g`;
              navigator.clipboard.writeText(prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="flex items-center gap-2 rounded-xl bg-card px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-card-hover"
          >
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
            {copied ? 'Copied!' : 'Copy prompt for Claude'}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  icon,
  loading,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {title}
        </h3>
        {loading && <Loader2 size={12} className="animate-spin text-muted" />}
      </div>
      <div className="border-t border-border">{children}</div>
    </div>
  );
}

function FoodRow({
  food,
  onSelect,
}: {
  food: FoodProduct;
  onSelect: (food: FoodProduct) => void;
}) {
  const touchStartY = useRef(0);
  const isTouchDevice = useRef(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onTouchStart={(e) => {
        isTouchDevice.current = true;
        touchStartY.current = e.touches[0].clientY;
      }}
      onTouchEnd={(e) => {
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
        // Only select if finger barely moved (tap, not scroll)
        if (dy < 10) {
          e.preventDefault(); // prevent the ghost click
          onSelect(food);
        }
      }}
      onClick={() => {
        // Only fire on desktop (mouse). Touch devices handled above.
        if (!isTouchDevice.current) onSelect(food);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(food); }}
      className="flex w-full cursor-pointer items-center justify-between border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-card-hover"
    >
      <div className="flex-1 overflow-hidden pr-3">
        <div className="truncate text-sm font-medium">{food.name}</div>
        <div className="flex gap-2 text-[11px] text-muted">
          {food.brand && <span className="truncate">{food.brand}</span>}
          <span className="shrink-0">{food.serving_size}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-highlight">
          {food.calories} cal
        </div>
        <div className="flex gap-1.5 text-[10px] tabular-nums text-muted">
          <span className="text-accent">{food.protein}P</span>
          <span className="text-highlight">{food.carbs}C</span>
          <span className="text-fat">{food.fat}F</span>
        </div>
      </div>
    </div>
  );
}

function foodToProduct(food: Food): FoodProduct {
  return {
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    fiber: food.fiber ?? 0,
    serving_size: `${food.serving_size} ${food.serving_unit}`,
    source: 'openfoodfacts',
  };
}
