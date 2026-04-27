'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Target, Key, Download, LogOut, Database, Palette, UtensilsCrossed, Watch } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

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
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Goals */}
      <Link
        href="/settings/goals"
        className="flex items-center gap-3 rounded-2xl bg-card px-4 py-4 transition-colors hover:bg-card-hover"
      >
        <Target size={20} className="text-accent" />
        <div className="flex-1">
          <div className="font-semibold">Daily Goals</div>
          <div className="text-sm text-muted">Calorie and macro targets</div>
        </div>
        <span className="text-muted">&rsaquo;</span>
      </Link>

      {/* My Foods */}
      <Link
        href="/foods"
        className="flex items-center gap-3 rounded-2xl bg-card px-4 py-4 transition-colors hover:bg-card-hover"
      >
        <UtensilsCrossed size={20} className="text-accent" />
        <div className="flex-1">
          <div className="font-semibold">My Foods</div>
          <div className="text-sm text-muted">View and edit custom foods</div>
        </div>
        <span className="text-muted">&rsaquo;</span>
      </Link>

      {/* Integrations */}
      <Link
        href="/settings/integrations"
        className="flex items-center gap-3 rounded-2xl bg-card px-4 py-4 transition-colors hover:bg-card-hover"
      >
        <Watch size={20} className="text-accent" />
        <div className="flex-1">
          <div className="font-semibold">Integrations</div>
          <div className="text-sm text-muted">Connect Garmin Connect</div>
        </div>
        <span className="text-muted">&rsaquo;</span>
      </Link>

      {/* Data Stats */}
      <div className="rounded-2xl bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Database size={18} className="text-accent" />
          <h3 className="font-semibold">Your Data</h3>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xl font-bold">{counts.entries}</div>
            <div className="text-xs text-muted">Diary Entries</div>
          </div>
          <div>
            <div className="text-xl font-bold">{counts.foods}</div>
            <div className="text-xs text-muted">Saved Foods</div>
          </div>
          <div>
            <div className="text-xl font-bold">{counts.weights}</div>
            <div className="text-xs text-muted">Weigh-ins</div>
          </div>
        </div>
        <button
          onClick={handleExportCSV}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-background py-2.5 text-sm text-accent transition-colors hover:bg-card-hover"
        >
          <Download size={16} />
          Export Diary CSV
        </button>
      </div>

      {/* API Keys */}
      <div className="rounded-2xl bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Key size={18} className="text-accent" />
          <h3 className="font-semibold">API Keys</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Nutritionix App ID</label>
            <input
              type="text"
              value={apiKeys.nutritionix_app_id}
              onChange={(e) => setApiKeys((k) => ({ ...k, nutritionix_app_id: e.target.value }))}
              className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="App ID"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Nutritionix App Key</label>
            <input
              type="password"
              value={apiKeys.nutritionix_app_key}
              onChange={(e) => setApiKeys((k) => ({ ...k, nutritionix_app_key: e.target.value }))}
              className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="App Key"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">USDA API Key</label>
            <input
              type="text"
              value={apiKeys.usda_api_key}
              onChange={(e) => setApiKeys((k) => ({ ...k, usda_api_key: e.target.value }))}
              className="w-full rounded-xl bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Leave blank for DEMO_KEY"
            />
          </div>
          <button
            onClick={saveApiKeys}
            disabled={saving}
            className="w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save API Keys'}
          </button>
        </div>
      </div>

      {/* Appearance */}
      <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-4">
        <div className="flex items-center gap-3">
          <Palette size={20} className="text-accent" />
          <span className="font-semibold">Appearance</span>
        </div>
        <ThemeToggle />
      </div>

      {/* Account */}
      <div className="space-y-2">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-4 text-left transition-colors hover:bg-card-hover"
        >
          <LogOut size={20} className="text-muted" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>

      <p className="text-center text-xs text-muted">Protocol Web v1</p>
    </div>
  );
}
