'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, Calculator, Activity, Scale, Check } from 'lucide-react';
import Link from 'next/link';
import { useGoals } from '@/lib/hooks/useGoals';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import { useWeightEntries } from '@/lib/hooks/useWeightEntries';
import { createClient } from '@/lib/supabase/client';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';

const dayLabels = ['Default', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KG_PER_LB = 0.453592;

// Multiplier presets for "protein per pound of bodyweight". The 0.7–1.2
// g/lb band covers everything from general health up through aggressive
// cuts. 1.0 g/lb is the default — it matches Bryan Johnson's Blueprint
// target (cited in the project pitch) and the TDEE wizard's "lose" preset.
const PROTEIN_PRESETS: { value: number; label: string; sub: string }[] = [
  { value: 0.7, label: '0.7', sub: 'General health' },
  { value: 0.8, label: '0.8', sub: 'Lean bulk' },
  { value: 1.0, label: '1.0', sub: 'Cut / preserve mass' },
  { value: 1.2, label: '1.2', sub: 'Aggressive cut' },
];

type ApplyState = 'idle' | 'saving' | 'saved' | 'error';

export default function GoalsPage() {
  const { goals, loading, updateGoal, createDayOverride, deleteDayOverride, refetch } = useGoals();
  const { profile } = useUserProfile();
  const { entries: weightEntries } = useWeightEntries();
  const supabase = useMemo(() => createClient(), []);

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
  const [fiber, setFiber] = useState(0);

  useEffect(() => {
    if (displayGoal) {
      setCalories(displayGoal.calories);
      setProtein(displayGoal.protein);
      setCarbs(displayGoal.carbs);
      setFat(displayGoal.fat);
      setFiber(displayGoal.fiber ?? 25);
    }
  }, [displayGoal]);

  function handleSave() {
    if (displayGoal) {
      updateGoal(displayGoal.id, { calories, protein, carbs, fat, fiber });
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
  const carbsCal = carbs * 4;
  const fatCal = fat * 9;
  const totalMacroCal = proteinCal + carbsCal + fatCal;
  const proteinPct = totalMacroCal > 0 ? (proteinCal / totalMacroCal) * 100 : 0;
  const carbsPct = totalMacroCal > 0 ? (carbsCal / totalMacroCal) * 100 : 0;
  const fatPct = totalMacroCal > 0 ? (fatCal / totalMacroCal) * 100 : 0;

  const daysWithOverrides = new Set(goals.filter((g) => g.day_of_week > 0).map((g) => g.day_of_week));

  // ---------- Apply protein-per-lb to all goal rows ----------
  const applyProteinToAllDays = useCallback(
    async (proteinGrams: number): Promise<ApplyState> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || goals.length === 0) return 'error';

      const rounded = Math.round(proteinGrams);
      const { error } = await supabase
        .from('daily_goals')
        .update({ protein: rounded })
        .eq('user_id', user.id);

      if (error) {
        console.warn('[goals] protein bulk update failed', error);
        return 'error';
      }
      await refetch();
      return 'saved';
    },
    [supabase, goals.length, refetch]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        Settings
      </Link>

      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="eyebrow text-accent">Targets</div>
        <h1 className="mt-2 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          Daily <span className="italic text-muted">goals</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Set the calorie and macro targets the coach plans against.
          Override any day of the week.
        </p>
      </header>

      {/* ============================================================
          Calculators — recommended path
          ============================================================ */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow text-accent">Recommended targets</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <h2 className="font-serif text-2xl leading-tight tracking-tight text-foreground sm:text-3xl">
          Calculators
        </h2>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TDEEEntryCard
            currentCalories={defaultGoal?.calories ?? null}
          />
          <ProteinQuickCalc
            profileWeightKg={profile?.weight_kg ?? null}
            latestWeightLbs={
              weightEntries.length > 0
                ? weightEntries[weightEntries.length - 1].weight
                : null
            }
            applyProteinToAllDays={applyProteinToAllDays}
            goalCount={goals.length}
          />
        </div>
      </section>

      {/* ============================================================
          Manual editor — fine-tuning per day
          ============================================================ */}
      <section className="space-y-4 pt-2">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Manual overrides</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Day selector */}
        <div className="glass flex gap-1 overflow-x-auto rounded-xl p-1.5">
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
            <div className="glass rounded-2xl p-4">
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
                className="mt-2 w-full rounded-xl bg-background px-4 py-3 text-center font-mono text-2xl font-bold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Macro inputs */}
            <div className="glass rounded-2xl p-4">
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
                <MacroInput
                  label="Fiber"
                  value={fiber}
                  onChange={setFiber}
                  color={colors.fiber}
                  pct={0}
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
      </section>
    </div>
  );
}

// ============================================================
// TDEE wizard entry card
// ============================================================

function TDEEEntryCard({ currentCalories }: { currentCalories: number | null }) {
  return (
    <div className="glass flex flex-col rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        <Activity size={14} className="text-accent" />
        <h3 className="eyebrow">TDEE wizard</h3>
      </div>
      <p className="text-sm text-muted">
        Compute your maintenance calories + macro split from age, sex,
        activity, and goal.
      </p>
      {currentCalories != null && currentCalories > 0 && (
        <div className="mt-4 flex items-baseline gap-2">
          <span className="eyebrow">Currently</span>
          <span className="font-mono text-2xl font-medium tabular-nums text-foreground">
            {Math.round(currentCalories)}
          </span>
          <span className="font-mono text-xs text-muted">kcal/day</span>
        </div>
      )}
      <div className="mt-auto pt-4">
        <div className="hairline mb-4 h-px" />
        <Link
          href="/settings/tdee"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/90 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent"
        >
          <Calculator size={14} />
          Open TDEE wizard
        </Link>
      </div>
    </div>
  );
}

// ============================================================
// Protein-from-bodyweight quick calc
// ============================================================

function ProteinQuickCalc({
  profileWeightKg,
  latestWeightLbs,
  applyProteinToAllDays,
  goalCount,
}: {
  profileWeightKg: number | null;
  latestWeightLbs: number | null;
  applyProteinToAllDays: (proteinGrams: number) => Promise<ApplyState>;
  goalCount: number;
}) {
  // Internal weight state, in lbs (we display in either unit but compute
  // protein from lbs to match the multiplier units).
  const [unit, setUnit] = useState<'kg' | 'lb'>('lb');
  const [weightInput, setWeightInput] = useState<string>('');
  const [multiplier, setMultiplier] = useState<number>(1.0);
  const [applyState, setApplyState] = useState<ApplyState>('idle');

  // Default-fill the weight input on first render (or when source data
  // arrives) — preference order: user_profile.weight_kg → latest weigh-in
  // → blank.
  useEffect(() => {
    if (weightInput.length > 0) return; // user has typed; don't clobber
    if (profileWeightKg != null && profileWeightKg > 0) {
      if (unit === 'kg') {
        setWeightInput(profileWeightKg.toFixed(1));
      } else {
        setWeightInput((profileWeightKg / KG_PER_LB).toFixed(1));
      }
      return;
    }
    if (latestWeightLbs != null && latestWeightLbs > 0) {
      if (unit === 'lb') {
        setWeightInput(latestWeightLbs.toFixed(1));
      } else {
        setWeightInput((latestWeightLbs * KG_PER_LB).toFixed(1));
      }
    }
    // Intentionally only depend on the source data + unit toggle — once
    // the user has typed, weightInput.length > 0 short-circuits above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileWeightKg, latestWeightLbs, unit]);

  // Convert displayed weight to lbs for the protein math
  const weightNum = parseFloat(weightInput);
  const weightLbs =
    Number.isFinite(weightNum) && weightNum > 0
      ? unit === 'kg'
        ? weightNum / KG_PER_LB
        : weightNum
      : 0;

  const proteinGrams = weightLbs * multiplier;
  const canCompute = weightLbs > 0;

  function handleUnitToggle(next: 'kg' | 'lb') {
    if (next === unit) return;
    // Convert the displayed value so the underlying weight stays the same.
    const n = parseFloat(weightInput);
    if (Number.isFinite(n) && n > 0) {
      if (unit === 'kg' && next === 'lb') {
        setWeightInput((n / KG_PER_LB).toFixed(1));
      } else if (unit === 'lb' && next === 'kg') {
        setWeightInput((n * KG_PER_LB).toFixed(1));
      }
    }
    setUnit(next);
  }

  async function handleApply() {
    if (!canCompute || goalCount === 0) return;
    setApplyState('saving');
    const result = await applyProteinToAllDays(proteinGrams);
    setApplyState(result);
    if (result === 'saved') {
      setTimeout(() => setApplyState('idle'), 2400);
    }
  }

  return (
    <div className="glass flex flex-col rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        <Scale size={14} className="text-accent" />
        <h3 className="eyebrow">Protein per pound</h3>
      </div>

      {/* Weight input + unit toggle */}
      <div className="flex items-stretch gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={weightInput}
          onChange={(e) => setWeightInput(e.target.value)}
          placeholder={unit === 'lb' ? '175' : '80'}
          className="flex-1 rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground placeholder:text-muted/50 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
          aria-label={`Bodyweight in ${unit}`}
        />
        <div className="flex gap-1 rounded-xl border border-border bg-glass-1 p-1">
          <button
            type="button"
            onClick={() => handleUnitToggle('lb')}
            className={cn(
              'rounded-lg px-3 text-[11px] font-mono uppercase tracking-[0.16em] transition-colors',
              unit === 'lb' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
            )}
          >
            lb
          </button>
          <button
            type="button"
            onClick={() => handleUnitToggle('kg')}
            className={cn(
              'rounded-lg px-3 text-[11px] font-mono uppercase tracking-[0.16em] transition-colors',
              unit === 'kg' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
            )}
          >
            kg
          </button>
        </div>
      </div>

      {/* Multiplier presets */}
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {PROTEIN_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setMultiplier(p.value)}
            className={cn(
              'rounded-lg border px-2 py-2 text-center transition-colors',
              multiplier === p.value
                ? 'border-accent bg-accent/10'
                : 'border-border bg-glass-1 hover:bg-glass-3'
            )}
            title={p.sub}
          >
            <div
              className={cn(
                'font-mono text-sm font-medium tabular-nums',
                multiplier === p.value ? 'text-accent' : 'text-foreground'
              )}
            >
              {p.label}
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted/80">
              g/lb
            </div>
          </button>
        ))}
      </div>

      {/* Live result */}
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          →
        </span>
        <span
          className={cn(
            'font-mono text-3xl font-medium tabular-nums',
            canCompute ? 'text-accent' : 'text-muted/40'
          )}
        >
          {canCompute ? Math.round(proteinGrams) : '—'}
        </span>
        <span className="font-mono text-xs text-muted">g protein/day</span>
      </div>
      <p className="mt-1 text-[11px] italic text-muted">
        Bryan Johnson&apos;s Blueprint targets 1g/lb.
      </p>

      <div className="mt-auto pt-4">
        <div className="hairline mb-4 h-px" />
        <button
          type="button"
          onClick={handleApply}
          disabled={!canCompute || goalCount === 0 || applyState === 'saving'}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/90 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applyState === 'saving' && 'Applying…'}
          {applyState === 'saved' && (
            <>
              <Check size={14} /> Applied to all goal days
            </>
          )}
          {(applyState === 'idle' || applyState === 'error') &&
            'Apply to all goal days'}
        </button>
        {applyState === 'error' && (
          <p className="mt-2 text-center text-[11px] text-danger">
            Couldn&apos;t save — please try again.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Manual editor — macro row
// ============================================================

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
        className="w-20 rounded-lg bg-background px-2 py-1.5 text-center font-mono text-sm font-medium tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <span className="text-sm text-muted">g</span>
      <span className="ml-auto font-mono text-xs tabular-nums text-muted">{Math.round(pct)}%</span>
    </div>
  );
}
