'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronLeft, Check } from 'lucide-react';
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

type ApplyState = 'idle' | 'saving' | 'saved' | 'error';

const steps = ['Profile', 'Activity', 'Goal', 'Results'];

export default function TDEEPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(0);
  const [applyState, setApplyState] = useState<ApplyState>('idle');

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
    setApplyState('saving');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setApplyState('error');
      return;
    }

    // Upsert (user_id, day_of_week=0) so this works whether or not the
    // default goal row exists. The handle_new_user trigger creates one at
    // signup, but make the wizard self-healing in case it was deleted.
    const { error } = await supabase
      .from('daily_goals')
      .upsert(
        {
          user_id: user.id,
          day_of_week: 0,
          calories: Math.round(macros.calories),
          protein: Math.round(macros.protein),
          carbs: Math.round(macros.carbs),
          fat: Math.round(macros.fat),
        },
        { onConflict: 'user_id,day_of_week' }
      );

    if (error) {
      console.warn('[TDEE] failed to apply goals', error);
      setApplyState('error');
      return;
    }

    setApplyState('saved');
    // Brief confirmation, then return to goals page so the user sees the
    // new defaults reflected in the editor below the calculators section.
    setTimeout(() => {
      router.push('/settings/goals');
    }, 900);
  }

  const stepLabel = steps[step];

  return (
    <div className="space-y-5">
      <Link
        href="/settings/goals"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        Goals
      </Link>

      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="flex items-center gap-3">
          <div className="eyebrow text-accent">Calculator</div>
          <div className="h-px flex-1 bg-border" />
          <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
            Step {String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')} · {stepLabel}
          </div>
        </div>
        <h1 className="mt-3 font-serif text-[44px] leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
          TDEE <span className="italic text-muted">wizard</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Compute maintenance calories and a macro split from age, sex,
          activity, and goal.
        </p>
      </header>

      {/* Step indicator — hairline progress with labelled dots */}
      <div className="glass flex items-center gap-2 rounded-full p-1.5">
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              'flex flex-1 items-center justify-center rounded-full py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
              i === step
                ? 'bg-accent text-white'
                : i < step
                ? 'text-accent'
                : 'text-muted/70'
            )}
          >
            <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
            <span className="ml-1.5 hidden sm:inline">{s}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && (
        <div className="glass space-y-4 rounded-2xl p-5">
          <div className="eyebrow">Your profile</div>

          {/* Units */}
          <div className="flex gap-1 rounded-xl border border-border bg-glass-1 p-1">
            <button
              onClick={() => setUseMetric(false)}
              className={cn(
                'flex-1 rounded-lg py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors',
                !useMetric ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              )}
            >
              Imperial
            </button>
            <button
              onClick={() => setUseMetric(true)}
              className={cn(
                'flex-1 rounded-lg py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors',
                useMetric ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              )}
            >
              Metric
            </button>
          </div>

          {/* Sex */}
          <div>
            <label className="eyebrow">Sex</label>
            <div className="mt-1.5 flex gap-1 rounded-xl border border-border bg-glass-1 p-1">
              <button
                onClick={() => setSex('male')}
                className={cn(
                  'flex-1 rounded-lg py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors',
                  sex === 'male' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                )}
              >
                Male
              </button>
              <button
                onClick={() => setSex('female')}
                className={cn(
                  'flex-1 rounded-lg py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors',
                  sex === 'female' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                )}
              >
                Female
              </button>
            </div>
          </div>

          {/* Age */}
          <div>
            <label className="eyebrow">Age</label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="25"
              className="mt-1.5 w-full rounded-xl border border-border bg-glass-1 px-4 py-3 font-mono text-sm tabular-nums text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {/* Weight */}
          <div>
            <label className="eyebrow">Weight ({useMetric ? 'kg' : 'lbs'})</label>
            <input
              type="number"
              value={useMetric ? weightKg : weightText}
              onChange={(e) => useMetric ? setWeightKg(e.target.value) : setWeightText(e.target.value)}
              placeholder={useMetric ? '80' : '175'}
              className="mt-1.5 w-full rounded-xl border border-border bg-glass-1 px-4 py-3 font-mono text-sm tabular-nums text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {/* Height */}
          <div>
            <label className="eyebrow">Height</label>
            {useMetric ? (
              <input
                type="number"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                placeholder="175 cm"
                className="mt-1.5 w-full rounded-xl border border-border bg-glass-1 px-4 py-3 font-mono text-sm tabular-nums text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
              />
            ) : (
              <div className="mt-1.5 flex gap-2">
                <input
                  type="number"
                  value={heightFeet}
                  onChange={(e) => setHeightFeet(e.target.value)}
                  placeholder="ft"
                  className="flex-1 rounded-xl border border-border bg-glass-1 px-4 py-3 font-mono text-sm tabular-nums text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
                />
                <input
                  type="number"
                  value={heightInches}
                  onChange={(e) => setHeightInches(e.target.value)}
                  placeholder="in"
                  className="flex-1 rounded-xl border border-border bg-glass-1 px-4 py-3 font-mono text-sm tabular-nums text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="glass space-y-3 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Activity level</div>
            <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.18em] text-muted">
              BMR · {Math.round(bmr)} kcal
            </div>
          </div>
          <div className="space-y-2">
            {activityLevels.map((level) => (
              <button
                key={level.key}
                onClick={() => setActivity(level.key)}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  activity === level.key
                    ? 'border-accent/60 bg-accent-light'
                    : 'border-border bg-glass-1 hover:bg-glass-3'
                )}
              >
                <div className="font-medium text-foreground">{level.label}</div>
                <div className="text-xs text-muted">{level.subtitle}</div>
              </button>
            ))}
          </div>
          <div className="hairline mt-3 h-px" />
          <div className="flex items-baseline justify-end gap-2 pt-1">
            <span className="eyebrow text-accent">TDEE</span>
            <span className="font-mono text-2xl font-medium tabular-nums text-foreground">
              {Math.round(tdee)}
            </span>
            <span className="font-mono text-xs text-muted">kcal/day</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="glass space-y-4 rounded-2xl p-5">
          <div className="eyebrow">Your goal</div>
          <div className="space-y-2">
            {goalTypes.map((gt) => (
              <button
                key={gt.key}
                onClick={() => { setGoalType(gt.key); setAdjustment(gt.adjustment); }}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  goalType === gt.key
                    ? 'border-accent/60 bg-accent-light'
                    : 'border-border bg-glass-1 hover:bg-glass-3'
                )}
              >
                <div className="font-medium text-foreground">{gt.label}</div>
              </button>
            ))}
          </div>

          <div>
            <label className="eyebrow">Calorie adjustment</label>
            <div className="mt-1.5 flex gap-1 rounded-xl border border-border bg-glass-1 p-1">
              {adjustmentOptions.map((adj) => (
                <button
                  key={adj}
                  onClick={() => setAdjustment(adj)}
                  className={cn(
                    'flex-1 rounded-lg py-2 font-mono text-[11px] tabular-nums transition-colors',
                    adjustment === adj ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                  )}
                >
                  {adj > 0 ? `+${adj}` : adj}
                </button>
              ))}
            </div>
          </div>

          <div className="hairline h-px" />
          <div className="flex items-baseline justify-end gap-2">
            <span className="eyebrow text-accent">Target</span>
            <span className="font-mono text-2xl font-medium tabular-nums text-foreground">
              {Math.round(macros.calories)}
            </span>
            <span className="font-mono text-xs text-muted">kcal/day</span>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="glass rounded-2xl p-6 text-center">
            <div className="eyebrow text-accent">Daily target</div>
            <div className="mt-2 font-mono text-5xl font-medium tabular-nums text-foreground">
              {Math.round(macros.calories)}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              kcal
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="glass rounded-xl p-3 text-center">
              <div className="font-mono text-lg font-medium tabular-nums" style={{ color: colors.accent }}>
                {Math.round(macros.protein)}g
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                Protein {Math.round(macros.proteinPercent)}%
              </div>
            </div>
            <div className="glass rounded-xl p-3 text-center">
              <div className="font-mono text-lg font-medium tabular-nums" style={{ color: colors.highlight }}>
                {Math.round(macros.carbs)}g
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                Carbs {Math.round(macros.carbsPercent)}%
              </div>
            </div>
            <div className="glass rounded-xl p-3 text-center">
              <div className="font-mono text-lg font-medium tabular-nums" style={{ color: colors.fat }}>
                {Math.round(macros.fat)}g
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                Fat {Math.round(macros.fatPercent)}%
              </div>
            </div>
          </div>

          {/* Split bar */}
          <div className="flex h-2 overflow-hidden rounded-full border border-border">
            <div style={{ width: `${macros.proteinPercent}%`, backgroundColor: colors.accent }} />
            <div style={{ width: `${macros.carbsPercent}%`, backgroundColor: colors.highlight }} />
            <div style={{ width: `${macros.fatPercent}%`, backgroundColor: colors.fat }} />
          </div>

          {/* Rationale */}
          <div className="glass rounded-2xl p-4">
            <div className="eyebrow">Rationale</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {goalTypes.find((g) => g.key === goalType)?.rationale}
            </p>
          </div>

          <button
            onClick={applyToGoals}
            disabled={applyState === 'saving' || applyState === 'saved'}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/90 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent disabled:opacity-80"
          >
            {applyState === 'saving' && 'Saving…'}
            {applyState === 'saved' && (
              <>
                <Check size={14} /> Saved — opening goals
              </>
            )}
            {(applyState === 'idle' || applyState === 'error') && 'Apply to goals'}
          </button>

          {applyState === 'error' && (
            <p className="text-center text-xs text-danger">
              Couldn&apos;t save — please try again.
            </p>
          )}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="glass flex flex-1 items-center justify-center gap-1 rounded-xl py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted transition-colors hover:text-foreground"
          >
            <ChevronLeft size={14} />
            Back
          </button>
        )}
        {step < 3 && (
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 && !isProfileValid}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-accent/40 bg-accent/90 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent disabled:opacity-50"
          >
            Next
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
