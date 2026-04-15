'use client';

import { useState } from 'react';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { NutritionLabel } from './NutritionLabel';
import { useFoods } from '@/lib/hooks/useFoods';
import { cn } from '@/lib/utils/cn';

interface CreateFoodFormProps {
  onBack: () => void;
  onCreated: (foodId: string) => void;
}

export function CreateFoodForm({ onBack, onCreated }: CreateFoodFormProps) {
  const { createFood } = useFoods();
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [aiEstimated, setAiEstimated] = useState(false);

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [servingSize, setServingSize] = useState('1');
  const [servingUnit, setServingUnit] = useState('serving');

  const cal = parseFloat(calories) || 0;
  const prot = parseFloat(protein) || 0;
  const carb = parseFloat(carbs) || 0;
  const fatVal = parseFloat(fat) || 0;
  const fiberVal = parseFloat(fiber) || 0;

  async function handleEstimate() {
    if (!name.trim() || estimating) return;
    setEstimating(true);
    try {
      const res = await fetch('/api/food/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), brand: brand.trim() || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setCalories(String(data.calories ?? ''));
        setProtein(String(data.protein ?? ''));
        setCarbs(String(data.carbs ?? ''));
        setFat(String(data.fat ?? ''));
        setFiber(String(data.fiber ?? ''));
        setAiEstimated(true);
      }
    } catch {
      // silently fail
    } finally {
      setEstimating(false);
    }
  }

  const isValid = name.trim().length > 0 && cal > 0;

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);

    const food = await createFood({
      name: name.trim(),
      brand: brand.trim(),
      barcode: barcode.trim(),
      calories: cal,
      protein: prot,
      carbs: carb,
      fat: fatVal,
      fiber: fiberVal,
      serving_size: parseFloat(servingSize) || 1,
      serving_unit: servingUnit.trim() || 'serving',
      is_custom: true,
      is_favorite: false,
    });

    setSaving(false);

    if (food) {
      onCreated(food.id);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-lg font-bold">Create Custom Food</h2>
      </div>

      {/* Live nutrition preview */}
      <NutritionLabel calories={cal} protein={prot} carbs={carb} fat={fatVal} fiber={fiberVal} />

      {/* Form fields */}
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label="Name *" value={name} onChange={setName} placeholder="e.g. Greek Yogurt" />
          </div>
          <button
            onClick={handleEstimate}
            disabled={!name.trim() || estimating}
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              name.trim() && !estimating
                ? 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'bg-card text-muted cursor-not-allowed'
            )}
          >
            {estimating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Estimate
          </button>
        </div>
        {aiEstimated && (
          <span className="text-[11px] font-medium text-accent/70">AI estimated</span>
        )}
        <FormField label="Brand" value={brand} onChange={setBrand} placeholder="e.g. Fage" />
        <FormField label="Barcode" value={barcode} onChange={setBarcode} placeholder="Optional" />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Serving Size"
            value={servingSize}
            onChange={setServingSize}
            type="number"
            placeholder="1"
          />
          <FormField
            label="Serving Unit"
            value={servingUnit}
            onChange={setServingUnit}
            placeholder="serving, cup, g..."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Calories *"
            value={calories}
            onChange={setCalories}
            type="number"
            placeholder="0"
          />
          <FormField
            label="Protein (g)"
            value={protein}
            onChange={setProtein}
            type="number"
            placeholder="0"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Carbs (g)"
            value={carbs}
            onChange={setCarbs}
            type="number"
            placeholder="0"
          />
          <FormField
            label="Fat (g)"
            value={fat}
            onChange={setFat}
            type="number"
            placeholder="0"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Fiber (g)"
            value={fiber}
            onChange={setFiber}
            type="number"
            placeholder="0"
          />
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!isValid || saving}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white transition-opacity',
          isValid ? 'bg-accent hover:opacity-90' : 'bg-accent/40 cursor-not-allowed'
        )}
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        Save Food
      </button>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        step={type === 'number' ? 'any' : undefined}
        className="w-full rounded-xl bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
