'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  ChefHat,
  History,
  TrendingUp,
  Settings,
  Dna,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const tabs = [
  { href: '/dashboard', label: 'Coach', icon: LayoutDashboard, idx: '01' },
  { href: '/history', label: 'History', icon: History, idx: '02' },
  { href: '/genome', label: 'Genome', icon: Dna, idx: '03' },
  { href: '/diary', label: 'Diary', icon: BookOpen, idx: '04' },
  { href: '/recipes', label: 'Recipes', icon: ChefHat, idx: '05' },
  { href: '/progress', label: 'Progress', icon: TrendingUp, idx: '06' },
  { href: '/settings', label: 'Settings', icon: Settings, idx: '07' },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-24 lg:pb-0 lg:pl-64">
        <div className="mx-auto max-w-2xl px-4 py-8 animate-[fadeIn_0.25s_ease-out] sm:px-6">
          {children}
        </div>
      </main>

      {/* Desktop sidebar — glass pane, serif wordmark, mono indices */}
      <nav className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border lg:flex">
        <div className="absolute inset-0 -z-10 bg-glass-1 backdrop-blur-xl" />
        {/* Wordmark */}
        <div className="flex h-20 items-end px-6 pb-4">
          <div>
            <div className="eyebrow">Protocol</div>
            <div className="mt-0.5 font-serif text-2xl leading-none tracking-tight text-foreground">
              <span className="italic">daily</span>{' '}
              <span className="text-muted">/</span> coach
            </div>
          </div>
        </div>

        <div className="mx-3 my-2 h-px bg-border" />

        <div className="space-y-0.5 px-3 py-2">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all',
                  isActive
                    ? 'bg-glass-3 text-foreground'
                    : 'text-muted hover:bg-glass-2 hover:text-foreground'
                )}
              >
                {/* Accent bar on active */}
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-sm transition-all',
                    isActive ? 'bg-accent' : 'bg-transparent'
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums tracking-wider transition-colors',
                    isActive ? 'text-accent' : 'text-muted/60'
                  )}
                >
                  {tab.idx}
                </span>
                <tab.icon
                  size={16}
                  className={cn(
                    'transition-colors',
                    isActive ? 'text-accent' : 'text-muted/80'
                  )}
                />
                <span className="font-medium tracking-wide">{tab.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-auto px-6 py-5">
          <div className="rounded-xl border border-border bg-glass-1 p-3">
            <div className="eyebrow">Build</div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-foreground">
              v1.0.0 / preview
            </div>
            <div className="mt-2 font-serif text-xs italic leading-snug text-muted">
              &ldquo;Don&rsquo;t die today.&rdquo;
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar — glass pill */}
      <nav className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
        <div className="glass-strong flex justify-around rounded-2xl px-1 py-1.5 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.4)]">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[10px] transition-all',
                  isActive
                    ? 'text-accent'
                    : 'text-muted/80 hover:text-foreground'
                )}
              >
                <tab.icon size={18} strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="font-mono uppercase tracking-[0.12em]">
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
