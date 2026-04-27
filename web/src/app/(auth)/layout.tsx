/**
 * Auth shell — hosts the one deliberate "abstract modern art" element:
 * a fixed blurred mesh-gradient blob pinned behind the form. Single SVG
 * with an feGaussianBlur filter, low opacity, drifting slowly.
 *
 * The blob is intentionally the only decorative flourish in the entire
 * app. Auth screens read as an arrival; from /dashboard onward we go
 * back to disciplined glass + grain.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-col">
      {/* Decorative backdrop — the lone abstract gradient blob */}
      <AuthBackdrop />

      {/* Top wordmark / minimal masthead */}
      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[28px] leading-none tracking-tight text-foreground">
            Protocol
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-muted sm:inline">
            v1 · clinical
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          AI&nbsp;Health Coach
        </span>
      </header>

      {/* Form pane */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-20">
        {children}
      </main>

      {/* Lower meta — page numbers / coordinates as a Bryan-Johnson nod */}
      <footer className="relative z-10 flex items-center justify-between px-6 pb-6 text-[10px] font-mono uppercase tracking-[0.24em] text-muted/70 sm:px-10">
        <span>41.7886° N · 87.5987° W</span>
        <span>page 001 / auth</span>
      </footer>
    </div>
  );
}

function AuthBackdrop() {
  return (
    <>
      {/* Hairline frame — reads as a clinical chart border */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-3 z-0 rounded-[28px] border border-border/60 sm:inset-5"
      />

      {/* The blob itself */}
      <svg
        aria-hidden
        viewBox="0 0 1200 900"
        className="pointer-events-none fixed inset-0 z-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id="auth-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="80" />
          </filter>
          <radialGradient id="auth-grad-a" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(96,165,250)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="rgb(96,165,250)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="auth-grad-b" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(168,138,248)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="rgb(168,138,248)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="auth-grad-c" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(245,184,90)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="rgb(245,184,90)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g
          filter="url(#auth-blur)"
          style={{
            animation: 'blobDrift 22s ease-in-out infinite',
            transformOrigin: 'center',
          }}
        >
          <ellipse cx="900" cy="220" rx="380" ry="280" fill="url(#auth-grad-a)" />
          <ellipse cx="220" cy="700" rx="420" ry="320" fill="url(#auth-grad-b)" />
          <ellipse cx="600" cy="450" rx="260" ry="200" fill="url(#auth-grad-c)" />
        </g>
      </svg>
    </>
  );
}
