import { Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ToolStatus = 'pending' | 'running' | 'success' | 'error';

interface Props {
  name: string;
  status: ToolStatus;
}

const labelFor: Record<string, string> = {
  regenerate_workout: 'Rewriting today’s workout',
  swap_meal: 'Swapping meal',
};

export function ToolActivityChip({ name, status }: Props) {
  const label = labelFor[name] ?? name;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
        status === 'success' && 'border-fiber/30 bg-fiber-light text-fiber',
        status === 'error' && 'border-danger/30 bg-danger/10 text-danger',
        (status === 'pending' || status === 'running') &&
          'border-border bg-glass-2 text-muted'
      )}
    >
      {status === 'pending' || status === 'running' ? (
        <Loader2 size={11} className="animate-spin" />
      ) : status === 'success' ? (
        <CheckCircle2 size={11} />
      ) : status === 'error' ? (
        <XCircle size={11} />
      ) : (
        <Wrench size={11} />
      )}
      <span>{label}</span>
    </div>
  );
}
