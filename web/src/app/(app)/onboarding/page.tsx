'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Dumbbell,
  Plus,
  Sparkles,
  Target,
  User,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import type { Gender, TrainingExperience } from '@/lib/types/models';

const DIETARY_PRESETS = [
  'vegan',
  'vegetarian',
  'gluten-free',
  'dairy-free',
  'nut allergy',
  'shellfish allergy',
] as const;

const EQUIPMENT_PRESETS = [
  'gym membership',
  'dumbbells',
  'barbell',
  'pull-up bar',
  'bench',
  'treadmill',
  'bike',
  'rower',
  'kettlebell',
  'bodyweight only',
] as const;

const ACTIVITY_PRESETS = ['rest', 'lift', 'run', 'cycle', 'swim', 'mobility'] as const;

const DAYS = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
] as const;

type DayKey = (typeof DAYS)[number]['key'];

const TOTAL_STEPS = 4;

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const TRAINING_EXPERIENCE_OPTIONS: {
  value: TrainingExperience;
  label: string;
  hint: string;
}[] = [
  { value: 'beginner', label: 'Beginner', hint: '<1 year of structured training' },
  { value: 'intermediate', label: 'Intermediate', hint: '1-5 years' },
  { value: 'advanced', label: 'Advanced', hint: '5+ years' },
];

type WeightUnit = 'kg' | 'lb';
type HeightUnit = 'cm' | 'in';

function lbToKg(lb: number): number {
  return lb / 2.2046226218;
}
function kgToLb(kg: number): number {
  return kg * 2.2046226218;
}
function inToCm(inches: number): number {
  return inches * 2.54;
}
function cmToIn(cm: number): number {
  return cm / 2.54;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, loading } = useUserProfile();

  const [step, setStep] = useState(1);
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [dietary, setDietary] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<Record<DayKey, string[]>>({
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  });

  // Demographics (step 2)
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [heightInput, setHeightInput] = useState(''); // raw user input for current unit
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [weightInput, setWeightInput] = useState(''); // raw user input for current unit
  const [trainingExperience, setTrainingExperience] = useState<
    TrainingExperience | ''
  >('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Hydrate from existing profile (re-running onboarding to edit values).
  useEffect(() => {
    if (!profile) return;
    if (typeof profile.goals?.primary === 'string') setPrimary(profile.goals.primary);
    if (typeof profile.goals?.secondary === 'string') setSecondary(profile.goals.secondary);
    if (Array.isArray(profile.dietary_restrictions)) setDietary(profile.dietary_restrictions);
    if (Array.isArray(profile.equipment_available)) setEquipment(profile.equipment_available);
    if (profile.weekly_schedule && typeof profile.weekly_schedule === 'object') {
      setSchedule((prev) => {
        const next = { ...prev };
        for (const day of DAYS) {
          const v = profile.weekly_schedule[day.key];
          if (Array.isArray(v)) next[day.key] = v.filter((x): x is string => typeof x === 'string');
        }
        return next;
      });
    }
    if (typeof profile.dob === 'string') setDob(profile.dob);
    if (typeof profile.gender === 'string') setGender(profile.gender as Gender);
    if (typeof profile.height_cm === 'number') {
      setHeightUnit('cm');
      setHeightInput(String(Math.round(profile.height_cm)));
    }
    if (typeof profile.weight_kg === 'number') {
      setWeightUnit('kg');
      setWeightInput(String(Math.round(profile.weight_kg * 10) / 10));
    }
    if (typeof profile.training_experience === 'string') {
      setTrainingExperience(profile.training_experience as TrainingExperience);
    }
  }, [profile]);

  const canAdvanceStep1 = primary.trim().length > 0;

  async function handleSubmit() {
    setError('');
    setSubmitting(true);

    // Convert demographics to canonical units before submit.
    const heightCm = (() => {
      const n = parseFloat(heightInput);
      if (!Number.isFinite(n) || n <= 0) return null;
      return heightUnit === 'cm' ? n : inToCm(n);
    })();
    const weightKg = (() => {
      const n = parseFloat(weightInput);
      if (!Number.isFinite(n) || n <= 0) return null;
      return weightUnit === 'kg' ? n : lbToKg(n);
    })();

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goals: {
            primary: primary.trim(),
            secondary: secondary.trim() || undefined,
          },
          dietary_restrictions: dietary,
          equipment_available: equipment,
          weekly_schedule: schedule,
          dob: dob || null,
          gender: gender || null,
          height_cm: heightCm,
          weight_kg: weightKg,
          training_experience: trainingExperience || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || 'Failed to save');
      }
      router.push('/dashboard');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted">
          Setup
        </div>
        <h1 className="text-2xl font-bold text-foreground">Tell Protocol about you</h1>
        <p className="mt-1 text-sm text-muted">
          So Claude can tailor your daily plan instead of guessing.
        </p>
      </div>

      <ProgressIndicator step={step} total={TOTAL_STEPS} />

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <>
          {step === 1 && (
            <GoalsStep
              primary={primary}
              secondary={secondary}
              onPrimaryChange={setPrimary}
              onSecondaryChange={setSecondary}
            />
          )}
          {step === 2 && (
            <DemographicsStep
              dob={dob}
              gender={gender}
              heightUnit={heightUnit}
              heightInput={heightInput}
              weightUnit={weightUnit}
              weightInput={weightInput}
              trainingExperience={trainingExperience}
              onDobChange={setDob}
              onGenderChange={setGender}
              onHeightUnitChange={setHeightUnit}
              onHeightChange={setHeightInput}
              onWeightUnitChange={setWeightUnit}
              onWeightChange={setWeightInput}
              onTrainingExperienceChange={setTrainingExperience}
            />
          )}
          {step === 3 && (
            <RestrictionsStep
              dietary={dietary}
              equipment={equipment}
              onDietaryChange={setDietary}
              onEquipmentChange={setEquipment}
            />
          )}
          {step === 4 && (
            <ScheduleStep schedule={schedule} onScheduleChange={setSchedule} />
          )}

          {error && (
            <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <StepNav
            step={step}
            total={TOTAL_STEPS}
            canAdvance={step === 1 ? canAdvanceStep1 : true}
            submitting={submitting}
            onBack={() => setStep((s) => Math.max(1, s - 1))}
            onNext={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
            onSubmit={handleSubmit}
          />
        </>
      )}
    </div>
  );
}

// ============================================================
// Step 1: Goals
// ============================================================

function GoalsStep({
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
}: {
  primary: string;
  secondary: string;
  onPrimaryChange: (v: string) => void;
  onSecondaryChange: (v: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Target size={18} className="text-accent" />
        <h2 className="font-semibold text-foreground">Your goals</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-muted" htmlFor="primary">
            Primary goal
          </label>
          <input
            id="primary"
            type="text"
            value={primary}
            onChange={(e) => onPrimaryChange(e.target.value)}
            placeholder="e.g. sub-20 5K"
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1.5 text-xs text-muted">
            Be specific. Concrete targets produce better plans.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted" htmlFor="secondary">
            Secondary goal <span className="text-muted/60">(optional)</span>
          </label>
          <input
            id="secondary"
            type="text"
            value={secondary}
            onChange={(e) => onSecondaryChange(e.target.value)}
            placeholder="e.g. build muscle"
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Step 2: Demographics (coach v2)
// ============================================================

function DemographicsStep({
  dob,
  gender,
  heightUnit,
  heightInput,
  weightUnit,
  weightInput,
  trainingExperience,
  onDobChange,
  onGenderChange,
  onHeightUnitChange,
  onHeightChange,
  onWeightUnitChange,
  onWeightChange,
  onTrainingExperienceChange,
}: {
  dob: string;
  gender: Gender | '';
  heightUnit: HeightUnit;
  heightInput: string;
  weightUnit: WeightUnit;
  weightInput: string;
  trainingExperience: TrainingExperience | '';
  onDobChange: (v: string) => void;
  onGenderChange: (v: Gender | '') => void;
  onHeightUnitChange: (v: HeightUnit) => void;
  onHeightChange: (v: string) => void;
  onWeightUnitChange: (v: WeightUnit) => void;
  onWeightChange: (v: string) => void;
  onTrainingExperienceChange: (v: TrainingExperience | '') => void;
}) {
  function handleHeightUnitToggle(next: HeightUnit) {
    if (next === heightUnit) return;
    const n = parseFloat(heightInput);
    if (Number.isFinite(n) && n > 0) {
      const converted = next === 'cm' ? inToCm(n) : cmToIn(n);
      onHeightChange(String(Math.round(converted * 10) / 10));
    }
    onHeightUnitChange(next);
  }
  function handleWeightUnitToggle(next: WeightUnit) {
    if (next === weightUnit) return;
    const n = parseFloat(weightInput);
    if (Number.isFinite(n) && n > 0) {
      const converted = next === 'kg' ? lbToKg(n) : kgToLb(n);
      onWeightChange(String(Math.round(converted * 10) / 10));
    }
    onWeightUnitChange(next);
  }

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <User size={18} className="text-accent" />
        <h2 className="font-semibold text-foreground">About you</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        Used to scale recommendations by age, sex, and training age. All optional.
      </p>

      <div className="space-y-5">
        {/* Gender */}
        <div>
          <div className="mb-2 text-sm text-muted">Gender</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GENDER_OPTIONS.map((opt) => {
              const active = gender === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onGenderChange(active ? '' : opt.value)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-sm transition-colors',
                    active
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-border bg-background text-muted hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* DOB */}
        <div>
          <label className="mb-1.5 block text-sm text-muted" htmlFor="dob">
            Date of birth
          </label>
          <input
            id="dob"
            type="date"
            value={dob}
            onChange={(e) => onDobChange(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1.5 text-xs text-muted">
            We compute your age — never displayed publicly.
          </p>
        </div>

        {/* Height */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-sm text-muted" htmlFor="height">
              Height
            </label>
            <UnitToggle
              options={['cm', 'in']}
              value={heightUnit}
              onChange={(v) => handleHeightUnitToggle(v as HeightUnit)}
            />
          </div>
          <input
            id="height"
            type="number"
            inputMode="decimal"
            value={heightInput}
            onChange={(e) => onHeightChange(e.target.value)}
            placeholder={heightUnit === 'cm' ? 'e.g. 178' : 'e.g. 70'}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Weight */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-sm text-muted" htmlFor="weight">
              Current weight
            </label>
            <UnitToggle
              options={['kg', 'lb']}
              value={weightUnit}
              onChange={(v) => handleWeightUnitToggle(v as WeightUnit)}
            />
          </div>
          <input
            id="weight"
            type="number"
            inputMode="decimal"
            value={weightInput}
            onChange={(e) => onWeightChange(e.target.value)}
            placeholder={weightUnit === 'kg' ? 'e.g. 78' : 'e.g. 172'}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1.5 text-xs text-muted">
            Baseline — log day-to-day weight in the weight tracker.
          </p>
        </div>

        {/* Training experience */}
        <div>
          <div className="mb-2 text-sm text-muted">Training experience</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TRAINING_EXPERIENCE_OPTIONS.map((opt) => {
              const active = trainingExperience === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onTrainingExperienceChange(active ? '' : opt.value)
                  }
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                    active
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-border bg-background text-muted hover:text-foreground'
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-xs text-muted">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnitToggle({
  options,
  value,
  onChange,
}: {
  options: readonly [string, string];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              active
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:text-foreground'
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Step 3: Dietary restrictions + equipment
// ============================================================

function RestrictionsStep({
  dietary,
  equipment,
  onDietaryChange,
  onEquipmentChange,
}: {
  dietary: string[];
  equipment: string[];
  onDietaryChange: (v: string[]) => void;
  onEquipmentChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <TagSection
        icon={<Sparkles size={18} className="text-accent" />}
        title="Dietary restrictions"
        subtitle="Anything Protocol should never put in a meal."
        presets={DIETARY_PRESETS as readonly string[]}
        values={dietary}
        onChange={onDietaryChange}
        addPlaceholder="Add custom restriction"
      />
      <TagSection
        icon={<Dumbbell size={18} className="text-accent" />}
        title="Equipment available"
        subtitle="What you can use on a typical training day."
        presets={EQUIPMENT_PRESETS as readonly string[]}
        values={equipment}
        onChange={onEquipmentChange}
        addPlaceholder="Add custom equipment"
      />
    </div>
  );
}

function TagSection({
  icon,
  title,
  subtitle,
  presets,
  values,
  onChange,
  addPlaceholder,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  presets: readonly string[];
  values: string[];
  onChange: (v: string[]) => void;
  addPlaceholder: string;
}) {
  const [custom, setCustom] = useState('');
  const valueSet = useMemo(
    () => new Set(values.map((v) => v.toLowerCase())),
    [values]
  );

  function toggle(tag: string) {
    const key = tag.toLowerCase();
    if (valueSet.has(key)) {
      onChange(values.filter((v) => v.toLowerCase() !== key));
    } else {
      onChange([...values, tag]);
    }
  }

  function remove(tag: string) {
    onChange(values.filter((v) => v.toLowerCase() !== tag.toLowerCase()));
  }

  function addCustom() {
    const v = custom.trim();
    if (!v) return;
    if (!valueSet.has(v.toLowerCase())) {
      onChange([...values, v]);
    }
    setCustom('');
  }

  // Custom values = those selected that aren't in the preset list.
  const presetSet = useMemo(
    () => new Set(presets.map((p) => p.toLowerCase())),
    [presets]
  );
  const customValues = values.filter((v) => !presetSet.has(v.toLowerCase()));

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mb-4 text-xs text-muted">{subtitle}</p>

      <div className="flex flex-wrap gap-2">
        {presets.map((tag) => {
          const active = valueSet.has(tag.toLowerCase());
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-background text-muted hover:text-foreground'
              )}
            >
              {active && <Check size={14} />}
              {tag}
            </button>
          );
        })}
        {customValues.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-sm text-accent"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              className="text-accent/70 hover:text-accent"
              aria-label={`Remove ${tag}`}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={addPlaceholder}
          className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!custom.trim()}
          className="inline-flex items-center gap-1 rounded-xl bg-background px-3 py-2 text-sm text-accent transition-colors hover:bg-card-hover disabled:opacity-40"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Step 4: Weekly schedule
// ============================================================

function ScheduleStep({
  schedule,
  onScheduleChange,
}: {
  schedule: Record<DayKey, string[]>;
  onScheduleChange: (v: Record<DayKey, string[]>) => void;
}) {
  function toggle(day: DayKey, activity: string) {
    const current = schedule[day] ?? [];
    const has = current.includes(activity);
    const next = has
      ? current.filter((a) => a !== activity)
      : [...current, activity];
    onScheduleChange({ ...schedule, [day]: next });
  }

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={18} className="text-accent" />
        <h2 className="font-semibold text-foreground">Weekly schedule</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        What do you typically do each day? Pick any that apply.
      </p>

      <div className="space-y-3">
        {DAYS.map((day) => {
          const selected = schedule[day.key] ?? [];
          return (
            <div key={day.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="w-full text-xs font-medium uppercase tracking-wider text-muted sm:w-12">
                {day.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_PRESETS.map((activity) => {
                  const active = selected.includes(activity);
                  return (
                    <button
                      key={activity}
                      type="button"
                      onClick={() => toggle(day.key, activity)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border bg-background text-muted hover:text-foreground'
                      )}
                    >
                      {activity}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Step nav + progress
// ============================================================

function ProgressIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => i + 1).map((i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i <= step ? 'bg-accent' : 'bg-card'
          )}
        />
      ))}
      <span className="ml-2 text-xs text-muted">
        {step}/{total}
      </span>
    </div>
  );
}

function StepNav({
  step,
  total,
  canAdvance,
  submitting,
  onBack,
  onNext,
  onSubmit,
}: {
  step: number;
  total: number;
  canAdvance: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const isLast = step === total;
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        disabled={step === 1 || submitting}
        className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm text-muted transition-colors hover:bg-card-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      {isLast ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !canAdvance}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Done'}
          {!submitting && <Check size={16} />}
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Next
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
