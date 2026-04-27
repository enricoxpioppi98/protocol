'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, Trash2, Pencil, X, Star, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { colors } from '@/lib/constants/theme';
import type { Food } from '@/lib/types/models';

export default function FoodsPage() {
  const [foods, setFoods] = useState<Food[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Food | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const fetchFoods = useCallback(async () => {
    const { data } = await supabase
      .from('foods')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (data) setFoods(data as Food[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchFoods();
  }, [fetchFoods]);

  const filtered = search
    ? foods.filter(
        (f) =>
          f.name.toLowerCase().includes(search.toLowerCase()) ||
          f.brand.toLowerCase().includes(search.toLowerCase())
      )
    : foods;

  async function handleDelete(id: string) {
    await supabase.from('foods').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    setFoods((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleToggleFavorite(id: string, current: boolean) {
    await supabase.from('foods').update({ is_favorite: !current }).eq('id', id);
    setFoods((prev) => prev.map((f) => (f.id === id ? { ...f, is_favorite: !current } : f)));
  }

  return (
    <div className="space-y-5">
      <header className="mb-2 animate-[fadeIn_0.4s_ease-out]">
        <div className="flex items-center gap-3 animate-[fadeIn_0.5s_ease-out_0.05s_both]">
          <div className="eyebrow text-accent">Pantry</div>
          <div className="h-px flex-1 bg-border" />
          <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
            {foods.length.toString().padStart(3, '0')} items
          </div>
        </div>
        <h1 className="mt-3 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px] animate-[fadeIn_0.5s_ease-out_0.1s_both]">
          My <span className="italic text-muted">foods</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted animate-[fadeIn_0.5s_ease-out_0.18s_both]">
          Custom foods you&rsquo;ve saved or imported. Tap to edit.
        </p>
      </header>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Search foods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass w-full rounded-xl py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/50 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </div>

      {/* Food list */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl px-6 py-10 text-center">
          <p className="font-serif text-base italic text-muted">
            {search ? 'No foods match your search' : 'No custom foods yet'}
          </p>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-2xl divide-y divide-border">
          {filtered.map((food) => (
            <div
              key={food.id}
              className="group flex items-center justify-between px-4 py-3 transition-colors hover:bg-glass-3"
            >
              <button
                onClick={() => setEditing(food)}
                className="flex flex-1 flex-col gap-0.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{food.name}</span>
                  {food.is_custom && (
                    <span className="rounded-full border border-accent/30 bg-accent-light px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
                      Custom
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex gap-2 font-mono text-[10px] tabular-nums text-muted">
                  {food.brand && <span>{food.brand}</span>}
                  <span>{food.serving_size}{food.serving_unit}</span>
                </div>
              </button>

              <div className="flex items-center gap-2">
                <div className="flex gap-1.5 font-mono text-[10px] tabular-nums">
                  <span style={{ color: colors.highlight }}>{Math.round(food.calories)}</span>
                  <span style={{ color: colors.accent }}>{Math.round(food.protein)}P</span>
                  <span style={{ color: colors.highlight }}>{Math.round(food.carbs)}C</span>
                  <span style={{ color: colors.fat }}>{Math.round(food.fat)}F</span>
                  <span style={{ color: colors.fiber }}>{Math.round(food.fiber ?? 0)}Fi</span>
                </div>
                <button
                  onClick={() => handleToggleFavorite(food.id, food.is_favorite)}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:text-highlight"
                >
                  <Star size={14} fill={food.is_favorite ? colors.highlight : 'none'} stroke={food.is_favorite ? colors.highlight : 'currentColor'} />
                </button>
                <button
                  onClick={() => handleDelete(food.id)}
                  className="rounded-lg p-1.5 text-muted opacity-0 transition-all hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <EditFoodModal
          food={editing}
          onClose={() => setEditing(null)}
          onSave={async (updates) => {
            await supabase.from('foods').update(updates).eq('id', editing.id);
            setEditing(null);
            fetchFoods();
          }}
        />
      )}
    </div>
  );
}

function EditFoodModal({
  food,
  onClose,
  onSave,
}: {
  food: Food;
  onClose: () => void;
  onSave: (updates: Partial<Food>) => Promise<void>;
}) {
  const [name, setName] = useState(food.name);
  const [brand, setBrand] = useState(food.brand);
  const [calories, setCalories] = useState(String(food.calories));
  const [protein, setProtein] = useState(String(food.protein));
  const [carbs, setCarbs] = useState(String(food.carbs));
  const [fat, setFat] = useState(String(food.fat));
  const [fiber, setFiber] = useState(String(food.fiber ?? 0));
  const [servingSize, setServingSize] = useState(String(food.serving_size));
  const [servingUnit, setServingUnit] = useState(food.serving_unit);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);

  async function handleEstimate() {
    if (!name.trim()) return;
    setEstimating(true);
    try {
      const res = await fetch('/api/food/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), brand: brand.trim() || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setCalories(String(data.calories));
        setProtein(String(data.protein));
        setCarbs(String(data.carbs));
        setFat(String(data.fat));
        setFiber(String(data.fiber));
        if (data.serving_size) {
          const match = data.serving_size.match(/^([\d.]+)\s*(.*)$/);
          if (match) {
            setServingSize(match[1]);
            setServingUnit(match[2] || 'g');
          }
        }
      }
    } catch {}
    setEstimating(false);
  }

  async function handleSave() {
    setSaving(true);
    await onSave({
      name,
      brand,
      calories: parseFloat(calories) || 0,
      protein: parseFloat(protein) || 0,
      carbs: parseFloat(carbs) || 0,
      fat: parseFloat(fat) || 0,
      fiber: parseFloat(fiber) || 0,
      serving_size: parseFloat(servingSize) || 1,
      serving_unit: servingUnit,
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-6 sm:rounded-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold">Edit Food</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Name + AI button */}
          <div>
            <label className="mb-1 block text-xs text-muted">Name</label>
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-xl bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent" />
              <button onClick={handleEstimate} disabled={estimating || !name.trim()}
                className="rounded-xl bg-accent/15 px-3 py-2 text-accent disabled:opacity-50"
                title="Estimate with AI">
                {estimating ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" /> : <Sparkles size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Brand</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <NutrientInput label="Calories" value={calories} onChange={setCalories} color={colors.highlight} />
            <NutrientInput label="Protein (g)" value={protein} onChange={setProtein} color={colors.accent} />
            <NutrientInput label="Carbs (g)" value={carbs} onChange={setCarbs} color={colors.highlight} />
            <NutrientInput label="Fat (g)" value={fat} onChange={setFat} color={colors.fat} />
            <NutrientInput label="Fiber (g)" value={fiber} onChange={setFiber} color={colors.fiber} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Serving Size</label>
              <input type="number" value={servingSize} onChange={(e) => setServingSize(e.target.value)}
                className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Unit</label>
              <input value={servingUnit} onChange={(e) => setServingUnit(e.target.value)}
                className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NutrientInput({ label, value, onChange, color }: { label: string; value: string; onChange: (v: string) => void; color: string }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} step="0.1"
        className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent" />
    </div>
  );
}
