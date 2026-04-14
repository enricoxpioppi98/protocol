'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  calculateBMR,
  calculateTDEE,
  calculateMacros,
  activityLevels,
  goalTypes,
  adjustmentOptions,
  type TDEEInput,
  type Sex,
  type ActivityLevel,
  type GoalType,
} from '@/lib/utils/tdee';
import { colors } from '@/lib/constants/theme';
import { cn } from '@/lib/utils/cn';

const steps = ['Profile', 'Activity', 'Goal', 'Results'];

export default function TDEEPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(0);

  // Profile
  const [sex, setSex] = useState<Sex>('male');
  const [age, setAge] = useState('');
  const [weightText, setWeightText] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [useMetric, setUseMetric] = useState(false);
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');

  // Activity & Goal
  const [activity, setActivity] = useState<ActivityLevel>('moderatelyActive');
  const [goalType, setGoalType] = useState<GoalType>('maintain');
  const [adjustment, setAdjustment] = useState(0);

  const input: TDEEInput = {
    age: parseInt(age) || 0,
    sex,
    weightLbs: parseFloat(weightText) || 0,
    heightFeet: parseInt(heightFeet) || 0,
    heightInches: parseInt(heightInches) || 0,
    useMetric,
    weightKg: parseFloat(weightKg) || 0,
    heightCm: parseFloat(heightCm) || 0,
    activityLevel: activity,
    goalType,
    calorieAdjustment: adjustment,
    useBodyFat: false,
    bodyFatPercentage: 0,
  };

  const bmr = calculateBMR(input);
  const tdee = calculateTDEE(input);
  const macros = calculateMacros(input);

  const isProfileValid =
    input.age > 0 &&
    input.age < 120 &&
    (useMetric ? (input.weightKg ?? 0) > 0 : input.weightLbs > 0) &&
    (useMetric ? (input.heightCm ?? 0) > 0 : input.heightFeet > 0 || input.heightInches > 0);

  async function applyToGoals() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('daily_goals')
      .update({
        calories: Math.round(macros.calories),
        protein: Math.round(macros.protein),
        carbs: Math.round(macros.carbs),
        fat: Math.round(macros.fat),
      })
      .eq('user_id', user.id)
      .eq('day_of_week', 0);

    router.push('/settings/goals');
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings/goals" className="rounded-lg p-1.5 text-muted hover:bg-card-hover">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">TDEE Calculator</h1>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2">
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              'flex-1 rounded-full py-1 text-center text-xs font-medium transition-colors',
              i === step ? 'bg-accent text-white' : i < step ? 'bg-accent/30 text-accent' : 'bg-card text-muted'
            )}
          >
            {s}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && (
        <div className="space-y-4 rounded-2xl bg-card p-4">
          <h3 className="font-semibold">Your Profile</h3>

          {/* Units */}
          <div className="flex gap-1 rounded-xl bg-background p-1">
            <button onClick={() => setUseMetric(false)} className={cn('flex-1 rounded-lg py-2 text-sm font-medium', !useMetric ? 'bg-accent text-white' : 'text-muted')}>
              Imperial
            </button>
            <button onClick={() => setUseMetric(true)} className={cn('flex-1 rounded-lg py-2 text-sm font-medium', useMetric ? 'bg-accent text-white' : 'text-muted')}>
              Metric
            </button>
          </div>

          {/* Sex */}
          <div>
            <label className="mb-1.5 block text-sm text-muted">Sex</label>
            <div className="flex gap-1 rounded-xl bg-background p-1">
              <button onClick={() => setSex('male')} className={cn('flex-1 rounded-lg py-2 text-sm font-medium', sex === 'male' ? 'bg-accent text-white' : 'text-muted')}>Male</button>
              <button onClick={() => setSex('female')} className={cn('flex-1 rounded-lg py-2 text-sm font-medium', sex === 'female' ? 'bg-accent text-white' : 'text-muted')}>Female</button>
            </div>
          </div>

          {/* Age */}
          <div>
            <label className="mb-1.5 block text-sm text-muted">Age</label>
            <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="25" className="w-full rounded-xl bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>

          {/* Weight */}
          <div>
            <label className="mb-1.5 block text-sm text-muted">Weight ({useMetric ? 'kg' : 'lbs'})</label>
            <input type="number" value={useMetric ? weightKg : weightText} onChange={(e) => useMetric ? setWeightKg(e.target.value) : setWeightText(e.target.value)} placeholder={useMetric ? '80' : '175'} className="w-full rounded-xl bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>

          {/* Height */}
          <div>
            <label className="mb-1.5 block text-sm text-muted">Height</label>
            {useMetric ? (
              <input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="175 cm" className="w-full rounded-xl bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent" />
            ) : (
              <div className="flex gap-2">
                <input type="number" value={heightFeet} onChange={(e) => setHeightFeet(e.target.value)} placeholder="ft" className="flex-1 rounded-xl bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent" />
                <input type="number" value={heightInches} onChange={(e) => setHeightInches(e.target.value)} placeholder="in" className="flex-1 rounded-xl bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2 rounded-2xl bg-card p-4">
          <h3 className="font-semibold">Activity Level</h3>
          <p className="text-sm text-muted">BMR: {Math.round(bmr)} cal/day</p>
          <div className="space-y-2">
            {activityLevels.map((level) => (
              <button
                key={level.key}
                onClick={() => setActivity(level.key)}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  activity === level.key ? 'border-accent bg-accent/10' : 'border-border hover:bg-card-hover'
                )}
              >
                <div className="font-medium">{level.label}</div>
                <div className="text-sm text-muted">{level.subtitle}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 text-center text-lg font-bold" style={{ color: colors.accent }}>
            TDEE: {Math.round(tdee)} cal/day
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-2xl bg-card p-4">
          <h3 className="font-semibold">Your Goal</h3>
          <div className="space-y-2">
            {goalTypes.map((gt) => (
              <button
                key={gt.key}
                onClick={() => { setGoalType(gt.key); setAdjustment(gt.adjustment); }}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  goalType === gt.key ? 'border-accent bg-accent/10' : 'border-border hover:bg-card-hover'
                )}
              >
                <div className="font-medium">{gt.label}</div>
              </button>
            ))}
          </div>

          <div>
            <label className="mb-2 block text-sm text-muted">Calorie Adjustment</label>
            <div className="flex gap-1 rounded-xl bg-background p-1">
              {adjustmentOptions.map((adj) => (
                <button
                  key={adj}
                  onClick={() => setAdjustment(adj)}
                  className={cn(
                    'flex-1 rounded-lg py-2 text-xs font-medium transition-colors',
                    adjustment === adj ? 'bg-accent text-white' : 'text-muted'
                  )}
                >
                  {adj > 0 ? `+${adj}` : adj}
                </button>
              ))}
            </div>
          </div>

          <div className="text-center">
            <div className="text-sm text-muted">Target Calories</div>
            <div className="text-2xl font-bold" style={{ color: colors.highlight }}>
              {Math.round(macros.calories)}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-card p-5 text-center">
            <div className="text-sm text-muted">Daily Target</div>
            <div className="text-4xl font-bold" style={{ color: colors.highlight }}>
              {Math.round(macros.calories)}
            </div>
            <div className="text-sm text-muted">calories</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-card p-3 text-center">
              <div className="text-lg font-bold" style={{ color: colors.accent }}>{Math.round(macros.protein)}g</div>
              <div className="text-xs text-muted">Protein ({Math.round(macros.proteinPercent)}%)</div>
            </div>
            <div className="rounded-xl bg-card p-3 text-center">
              <div className="text-lg font-bold" style={{ color: colors.highlight }}>{Math.round(macros.carbs)}g</div>
              <div className="text-xs text-muted">Carbs ({Math.round(macros.carbsPercent)}%)</div>
            </div>
            <div className="rounded-xl bg-card p-3 text-center">
              <div className="text-lg font-bold" style={{ color: colors.fat }}>{Math.round(macros.fat)}g</div>
              <div className="text-xs text-muted">Fat ({Math.round(macros.fatPercent)}%)</div>
            </div>
          </div>

          {/* Split bar */}
          <div className="flex h-3 overflow-hidden rounded-full">
            <div style={{ width: `${macros.proteinPercent}%`, backgroundColor: colors.accent }} />
            <div style={{ width: `${macros.carbsPercent}%`, backgroundColor: colors.highlight }} />
            <div style={{ width: `${macros.fatPercent}%`, backgroundColor: colors.fat }} />
          </div>

          {/* Rationale */}
          <div className="rounded-xl bg-card p-4 text-sm text-muted">
            {goalTypes.find((g) => g.key === goalType)?.rationale}
          </div>

          <button
            onClick={applyToGoals}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply to Goals
          </button>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-card py-3 text-sm font-medium text-muted"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}
        {step < 3 && (
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 && !isProfileValid}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Next
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
