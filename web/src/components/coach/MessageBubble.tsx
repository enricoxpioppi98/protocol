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
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed backdrop-blur-md',
          role === 'user'
            ? 'border border-accent/40 bg-accent/85 text-white shadow-[0_4px_20px_-6px_rgb(96_165_250/0.45)]'
            : 'border border-border bg-glass-2 text-foreground'
        )}
      >
        {children}
      </div>
    </div>
  );
}
