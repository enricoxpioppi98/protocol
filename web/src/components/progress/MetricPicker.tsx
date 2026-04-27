'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  METRICS_BY_GROUP,
  METRIC_GROUPS,
  type MetricDef,
  type MetricGroup,
  MAX_SELECTED_METRICS,
} from './metricCatalog';

interface MetricPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

export function MetricPicker({ selected, onChange }: MetricPickerProps) {
  // Default open the groups that already have a selection.
  const [openGroups, setOpenGroups] = useState<Record<MetricGroup, boolean>>(() => {
    const out: Record<MetricGroup, boolean> = {
      Sleep: false, Heart: false, Movement: false, Energy: false, Nutrition: false, Body: false,
    };
    for (const g of METRIC_GROUPS) {
      if (METRICS_BY_GROUP[g].some((m) => selected.includes(m.id))) {
        out[g] = true;
      }
    }
    // If nothing's open, open Sleep so the picker isn't fully collapsed.
    if (!Object.values(out).some(Boolean)) out.Sleep = true;
    return out;
  });

  const isFull = selected.length >= MAX_SELECTED_METRICS;

  function toggle(metric: MetricDef) {
    const isOn = selected.includes(metric.id);
    if (isOn) {
      onChange(selected.filter((id) => id !== metric.id));
    } else {
      if (isFull) return; // hard cap
      onChange([...selected, metric.id]);
    }
  }

  function toggleGroup(g: MetricGroup) {
    setOpenGroups((s) => ({ ...s, [g]: !s[g] }));
  }

  return (
    <div className="rounded-2xl bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold">Metrics</h3>
          <p className="text-[11px] text-muted">
            Pick up to {MAX_SELECTED_METRICS}. {selected.length}/{MAX_SELECTED_METRICS} selected.
          </p>
        </div>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-card-hover hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {METRIC_GROUPS.map((g) => {
          const metrics = METRICS_BY_GROUP[g];
          if (metrics.length === 0) return null;
          const open = openGroups[g];
          const selectedInGroup = metrics.filter((m) => selected.includes(m.id)).length;
          return (
            <div key={g}>
              <button
                onClick={() => toggleGroup(g)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-card-hover/40"
              >
                <div className="flex items-center gap-2">
                  {open ? (
                    <ChevronDown size={14} className="text-muted" />
                  ) : (
                    <ChevronRight size={14} className="text-muted" />
                  )}
                  <span className="text-sm font-medium">{g}</span>
                  {selectedInGroup > 0 && (
                    <span className="rounded-full bg-accent-light px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      {selectedInGroup}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-muted">{metrics.length}</span>
              </button>
              {open && (
                <div className="grid grid-cols-1 gap-1 px-3 pb-3 sm:grid-cols-2">
                  {metrics.map((m) => {
                    const isOn = selected.includes(m.id);
                    const disabled = !isOn && isFull;
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggle(m)}
                        disabled={disabled}
                        className={cn(
                          'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                          isOn
                            ? 'bg-card-hover text-foreground'
                            : 'text-muted hover:bg-card-hover hover:text-foreground',
                          disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                            isOn ? 'border-transparent' : 'border-border bg-background'
                          )}
                          style={isOn ? { backgroundColor: m.color } : undefined}
                        >
                          {isOn && <Check size={11} className="text-white" />}
                        </span>
                        <span className="flex-1 truncate">{m.label}</span>
                        {m.unit && (
                          <span className="text-[10px] text-muted/70">{m.unit}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
