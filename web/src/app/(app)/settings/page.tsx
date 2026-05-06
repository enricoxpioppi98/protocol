'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Target, Key, Download, LogOut, Database, Palette, UtensilsCrossed, Watch } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { SeedDemoButton } from '@/components/settings/SeedDemoButton';

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [counts, setCounts] = useState({ entries: 0, foods: 0, weights: 0 });
  const [apiKeys, setApiKeys] = useState({
    nutritionix_app_id: '',
    nutritionix_app_key: '',
    usda_api_key: '',
  });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    const [entriesRes, foodsRes, weightsRes, settingsRes] = await Promise.all([
      supabase.from('diary_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('foods').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('weight_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('user_settings').select('*').single(),
    ]);

    setCounts({
      entries: entriesRes.count ?? 0,
      foods: foodsRes.count ?? 0,
      weights: weightsRes.count ?? 0,
    });

    if (settingsRes.data) {
      setApiKeys({
        nutritionix_app_id: settingsRes.data.nutritionix_app_id || '',
        nutritionix_app_key: settingsRes.data.nutritionix_app_key || '',
        usda_api_key: settingsRes.data.usda_api_key || '',
      });
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function saveApiKeys() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('user_settings')
        .update(apiKeys)
        .eq('user_id', user.id);
    }
    setSaving(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function handleExportCSV() {
    const { data: entries } = await supabase
      .from('diary_entries')
      .select('*, food:foods(name, calories, protein, carbs, fat)')
      .is('deleted_at', null)
      .order('date', { ascending: true });

    if (!entries || entries.length === 0) return;

    const csv = [
      'Date,Meal,Food,Servings,Calories,Protein,Carbs,Fat',
      ...entries.map((e: any) => {
        const f = e.food;
        const s = e.number_of_servings;
        return `${e.date},${e.meal_type},${f?.name ?? 'Recipe'},${s},${((f?.calories ?? 0) * s).toFixed(0)},${((f?.protein ?? 0) * s).toFixed(1)},${((f?.carbs ?? 0) * s).toFixed(1)},${((f?.fat ?? 0) * s).toFixed(1)}`;
      }),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'protocol-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <header className="animate-[fadeIn_0.4s_ease-out]">
        <div className="flex items-center gap-3">
          <div className="eyebrow text-accent">Configuration</div>
          <div className="h-px flex-1 bg-border" />
        </div>
        <h1 className="mt-3 font-serif text-[52px] leading-[0.95] tracking-tight text-foreground sm:text-[64px]">
          Settings
        </h1>
      </header>

      {/* Demo seeder — Track 23 (v3). Mounted at the very top so first-run
          users with empty dashboards can see it without scrolling. The card
          self-hides via localStorage once the user has used or dismissed it. */}
      <SeedDemoButton />

      {/* Section: Plan */}
      <SectionLabel n="01" label="Your plan" />

      <SettingsRow
        href="/settings/goals"
        icon={<Target size={16} className="text-accent" />}
        title="Daily goals"
        subtitle="Calorie and macro targets"
      />
      <SettingsRow
        href="/foods"
        icon={<UtensilsCrossed size={16} className="text-accent" />}
        title="My foods"
        subtitle="View and edit custom foods"
      />
      <SettingsRow
        href="/settings/integrations"
        icon={<Watch size={16} className="text-accent" />}
        title="Integrations"
        subtitle="Connect Garmin Connect"
      />

      {/* Section: Data */}
      <SectionLabel n="02" label="Your data" />

      <div className="glass rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-3">
          <Database size={14} className="text-accent" />
          <h3 className="eyebrow">Database</h3>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <DataStat n="01" value={counts.entries} label="Diary" />
          <DataStat n="02" value={counts.foods} label="Foods" />
          <DataStat n="03" value={counts.weights} label="Weigh-ins" />
        </div>
        <button
          onClick={handleExportCSV}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-glass-1 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-glass-3"
        >
          <Download size={13} />
          Export diary CSV
        </button>
      </div>

      {/* Section: Keys */}
      <SectionLabel n="03" label="External services" />

      <div className="glass rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-3">
          <Key size={14} className="text-accent" />
          <h3 className="eyebrow">API keys</h3>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-3">
          <KeyField
            label="Nutritionix App ID"
            type="text"
            value={apiKeys.nutritionix_app_id}
            onChange={(v) => setApiKeys((k) => ({ ...k, nutritionix_app_id: v }))}
            placeholder="App ID"
          />
          <KeyField
            label="Nutritionix App Key"
            type="password"
            value={apiKeys.nutritionix_app_key}
            onChange={(v) => setApiKeys((k) => ({ ...k, nutritionix_app_key: v }))}
            placeholder="App Key"
          />
          <KeyField
            label="USDA API Key"
            type="text"
            value={apiKeys.usda_api_key}
            onChange={(v) => setApiKeys((k) => ({ ...k, usda_api_key: v }))}
            placeholder="Leave blank for DEMO_KEY"
          />
          <button
            onClick={saveApiKeys}
            disabled={saving}
            className="w-full rounded-xl border border-accent/40 bg-accent/90 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save API keys'}
          </button>
        </div>
      </div>

      {/* Appearance */}
      <SectionLabel n="04" label="Interface" />
      <div className="glass flex items-center justify-between rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Palette size={16} className="text-accent" />
          <span className="font-medium text-foreground">Appearance</span>
        </div>
        <ThemeToggle />
      </div>

      {/* Account */}
      <SectionLabel n="05" label="Session" />
      <button
        onClick={handleSignOut}
        className="glass flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-glass-3"
      >
        <LogOut size={16} className="text-muted" />
        <span className="font-medium text-foreground">Sign out</span>
      </button>

      <p className="pt-3 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
        protocol · web · v1
      </p>
    </div>
  );
}

function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="mt-2 flex items-center gap-3 pt-1">
      <span className="font-mono text-[10px] tabular-nums tracking-widest text-muted/50">
        {n}
      </span>
      <span className="eyebrow">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function SettingsRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="glass group flex items-center gap-3 rounded-2xl px-5 py-4 transition-colors hover:bg-glass-3"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-glass-2">
        {icon}
      </span>
      <div className="flex-1">
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted">{subtitle}</div>
      </div>
      <span className="font-mono text-muted transition-transform group-hover:translate-x-0.5">
        &rsaquo;
      </span>
    </Link>
  );
}

function DataStat({ n, value, label }: { n: string; value: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] tabular-nums text-muted/40">{n}</div>
      <div className="mt-0.5 font-mono text-2xl font-medium tabular-nums text-foreground">
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
    </div>
  );
}

function KeyField({
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="eyebrow mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-glass-1 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/50 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
        placeholder={placeholder}
      />
    </div>
  );
}
