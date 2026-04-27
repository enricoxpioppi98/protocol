import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  role: 'user' | 'assistant';
  children: ReactNode;
}

export function MessageBubble({ role, children }: Props) {
  return (
    <div className={cn('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          role === 'user'
            ? 'bg-accent text-white'
            : 'bg-card-hover text-foreground'
        )}
      >
        {children}
      </div>
    </div>
  );
}
