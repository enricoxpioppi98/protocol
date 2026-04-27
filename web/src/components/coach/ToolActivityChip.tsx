import { Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ToolStatus = 'pending' | 'running' | 'success' | 'error';

interface Props {
  name: string;
  status: ToolStatus;
}

const labelFor: Record<string, string> = {
  regenerate_workout: 'Rewriting today’s workout',
};

export function ToolActivityChip({ name, status }: Props) {
  const label = labelFor[name] ?? name;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        status === 'success' && 'bg-fiber-light text-fiber',
        status === 'error' && 'bg-danger/10 text-danger',
        (status === 'pending' || status === 'running') &&
          'bg-card-hover text-muted'
      )}
    >
      {status === 'pending' || status === 'running' ? (
        <Loader2 size={12} className="animate-spin" />
      ) : status === 'success' ? (
        <CheckCircle2 size={12} />
      ) : status === 'error' ? (
        <XCircle size={12} />
      ) : (
        <Wrench size={12} />
      )}
      <span>{label}</span>
    </div>
  );
}
