'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, ChefHat, TrendingUp, Settings } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const tabs = [
  { href: '/diary', label: 'Diary', icon: BookOpen },
  { href: '/recipes', label: 'Recipes', icon: ChefHat },
  { href: '/progress', label: 'Progress', icon: TrendingUp },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0 lg:pl-64">
        <div className="mx-auto max-w-2xl px-4 py-6 animate-[fadeIn_0.2s_ease-out]">{children}</div>
      </main>

      {/* Desktop sidebar */}
      <nav className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-16 items-center px-6">
          <h1 className="text-lg font-bold text-foreground">MacroTracker</h1>
        </div>
        <div className="space-y-1 px-3">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-muted hover:bg-card-hover hover:text-foreground'
                )}
              >
                <tab.icon size={20} />
                {tab.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto px-6 py-4">
          <p className="text-[11px] text-muted/50">MacroTracker v1.0</p>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/80 backdrop-blur-xl lg:hidden">
        <div className="flex justify-around py-2">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex flex-col items-center gap-1 px-4 py-1 text-xs transition-colors',
                  isActive ? 'text-accent' : 'text-muted'
                )}
              >
                <tab.icon size={22} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
