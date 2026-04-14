'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Calculator } from 'lucide-react';
import Link from 'next/link';
import { useGoals } from '@/lib/hooks/useGoals';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';

const dayLabels = ['Default', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function GoalsPage() {
  const { goals, loading, updateGoal, createDayOverride, deleteDayOverride } = useGoals();
  const [selectedDay, setSelectedDay] = useState(0);

  // Find goal for selected day
  const currentGoal = goals.find((g) => g.day_of_week === selectedDay);
  const defaultGoal = goals.find((g) => g.day_of_week === 0);
  const displayGoal = currentGoal ?? defaultGoal;

  // Local state for editing
  const [calories, setCalories] = useState(0);
  const [protein, setProtein] = useState(0);
  const [carbs, setCarbs] = useState(0);
  const [fat, setFat] = useState(0);

  useEffect(() => {
    if (displayGoal) {
      setCalories(displayGoal.calories);
      setProtein(displayGoal.protein);
      setCarbs(displayGoal.carbs);
      setFat(displayGoal.fat);
    }
  }, [displayGoal]);

  function handleSave() {
    if (displayGoal) {
      updateGoal(displayGoal.id, { calories, protein, carbs, fat });
    }
  }

  async function handleCreateOverride() {
    if (defaultGoal && selectedDay > 0) {
      await createDayOverride(selectedDay, defaultGoal);
    }
  }

  async function handleDeleteOverride() {
    if (currentGoal && selectedDay > 0) {
      await deleteDayOverride(currentGoal.id);
    }
  }

  // Carbs/fat ratio
  const proteinCal = protein * 4;
  const remainingCal = Math.max(calories - proteinCal, 0);
  const carbsCal = carbs * 4;
  const fatCal = fat * 9;
  const totalMacroCal = proteinCal + carbsCal + fatCal;
  const proteinPct = totalMacroCal > 0 ? (proteinCal / totalMacroCal) * 100 : 0;
  const carbsPct = totalMacroCal > 0 ? (carbsCal / totalMacroCal) * 100 : 0;
  const fatPct = totalMacroCal > 0 ? (fatCal / totalMacroCal) * 100 : 0;

  const daysWithOverrides = new Set(goals.filter((g) => g.day_of_week > 0).map((g) => g.day_of_week));

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings" className="rounded-lg p-1.5 text-muted hover:bg-card-hover">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">Daily Goals</h1>
      </div>

      {/* Day selector */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-card p-1.5">
        {dayLabels.map((label, i) => (
          <button
            key={i}
            onClick={() => setSelectedDay(i)}
            className={cn(
              'relative flex-1 rounded-lg py-2 text-center text-xs font-medium transition-colors',
              selectedDay === i ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
            )}
          >
            {label}
            {i > 0 && daysWithOverrides.has(i) && (
              <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Override notice */}
      {selectedDay > 0 && !currentGoal && (
        <div className="rounded-xl bg-accent/10 px-4 py-3 text-center">
          <p className="text-sm text-muted">Using default goal for {dayLabels[selectedDay]}</p>
          <button
            onClick={handleCreateOverride}
            className="mt-2 text-sm font-medium text-accent"
          >
            Customize {dayLabels[selectedDay]}
          </button>
        </div>
      )}

      {displayGoal && (
        <>
          {/* Calories */}
          <div className="rounded-2xl bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Calories</h3>
              <Link href="/settings/tdee" className="flex items-center gap-1 text-sm text-accent">
                <Calculator size={14} />
                TDEE Calculator
              </Link>
            </div>
            <input
              type="number"
              value={calories}
              onChange={(e) => setCalories(parseInt(e.target.value) || 0)}
              className="mt-2 w-full rounded-xl bg-background px-4 py-3 text-center text-2xl font-bold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Macro inputs */}
          <div className="rounded-2xl bg-card p-4">
            <h3 className="mb-3 font-semibold">Macros</h3>

            {/* Macro split bar */}
            <div className="mb-4 flex h-3 overflow-hidden rounded-full">
              <div
                className="transition-all"
                style={{ width: `${proteinPct}%`, backgroundColor: colors.accent }}
              />
              <div
                className="transition-all"
                style={{ width: `${carbsPct}%`, backgroundColor: colors.highlight }}
              />
              <div
                className="transition-all"
                style={{ width: `${fatPct}%`, backgroundColor: colors.fat }}
              />
            </div>

            <div className="space-y-3">
              <MacroInput
                label="Protein"
                value={protein}
                onChange={setProtein}
                color={colors.accent}
                pct={proteinPct}
              />
              <MacroInput
                label="Carbs"
                value={carbs}
                onChange={setCarbs}
                color={colors.highlight}
                pct={carbsPct}
              />
              <MacroInput
                label="Fat"
                value={fat}
                onChange={setFat}
                color={colors.fat}
                pct={fatPct}
              />
            </div>

            <div className="mt-3 text-right text-xs text-muted">
              Total: {Math.round(proteinPct + carbsPct + fatPct)}%
              {' '}({Math.round(totalMacroCal)} cal)
            </div>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-white transition-opacity hover:opacity-90"
          >
            Save Goals
          </button>

          {/* Delete override */}
          {selectedDay > 0 && currentGoal && (
            <button
              onClick={handleDeleteOverride}
              className="w-full rounded-xl bg-danger/10 py-3 text-sm font-medium text-danger"
            >
              Remove {dayLabels[selectedDay]} Override
            </button>
          )}
        </>
      )}
    </div>
  );
}

function MacroInput({
  label,
  value,
  onChange,
  color,
  pct,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="w-16 text-sm">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-20 rounded-lg bg-background px-2 py-1.5 text-center text-sm font-medium tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <span className="text-sm text-muted">g</span>
      <span className="ml-auto text-xs text-muted">{Math.round(pct)}%</span>
    </div>
  );
}
