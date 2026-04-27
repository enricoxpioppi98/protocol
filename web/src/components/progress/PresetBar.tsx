'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { PRESETS, type Preset } from './metricCatalog';

interface PresetBarProps {
  selected: string[];
  onApply: (preset: Preset) => void;
}

function isPresetActive(preset: Preset, selected: string[]): boolean {
  if (preset.metricIds.length !== selected.length) return false;
  const selSet = new Set(selected);
  return preset.metricIds.every((id) => selSet.has(id));
}

export function PresetBar({ selected, onApply }: PresetBarProps) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Sparkles size={12} />
        Quick presets
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = isPresetActive(p, selected);
          return (
            <button
              key={p.id}
              onClick={() => onApply(p)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-accent text-white'
                  : 'bg-card-hover text-muted hover:text-foreground'
              )}
              title={p.metricIds.join(', ')}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
