'use client';

import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import type { GoalSuggestion } from '@/lib/utils/goalSuggestion';
import { cn } from '@/lib/utils/cn';

interface GoalSuggestionBannerProps {
  suggestion: GoalSuggestion;
  onDismiss: () => void;
}

const iconMap = {
  warning: AlertTriangle,
  success: CheckCircle,
  info: Info,
};

const colorMap = {
  warning: { bg: 'bg-highlight/10', text: 'text-highlight', border: 'border-highlight/20' },
  success: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/20' },
  info: { bg: 'bg-accent/10', text: 'text-accent', border: 'border-accent/20' },
};

export function GoalSuggestionBanner({ suggestion, onDismiss }: GoalSuggestionBannerProps) {
  const Icon = iconMap[suggestion.type];
  const colors = colorMap[suggestion.type];

  return (
    <div className={cn('rounded-2xl border p-4', colors.bg, colors.border)}>
      <div className="flex items-start gap-3">
        <Icon size={20} className={cn('mt-0.5 shrink-0', colors.text)} />
        <div className="flex-1">
          <div className={cn('font-semibold', colors.text)}>{suggestion.message}</div>
          <div className="mt-1 text-sm text-muted">{suggestion.detail}</div>
        </div>
        <button onClick={onDismiss} className="rounded-lg p-1 text-muted hover:bg-card-hover">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
