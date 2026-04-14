'use client';

import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type Theme = 'system' | 'light' | 'dark';

const icons: Record<Theme, React.ElementType> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const cycle: Theme[] = ['system', 'light', 'dark'];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored && cycle.includes(stored)) {
      setTheme(stored);
    }
  }, []);

  function toggle() {
    const next = cycle[(cycle.indexOf(theme) + 1) % cycle.length];
    setTheme(next);

    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    } else {
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    }
  }

  const Icon = icons[theme];

  return (
    <button
      onClick={toggle}
      className={cn(
        'rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground'
      )}
      title={`Theme: ${theme}`}
    >
      <Icon size={18} />
    </button>
  );
}
