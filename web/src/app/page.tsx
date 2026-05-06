import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Code2,
  Dna,
  Droplets,
  Heart,
  Sparkles,
  Watch,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { SourceChip } from '@/components/ui/SourceChip';
import type { BiometricsSource } from '@/lib/types/models';

/**
 * Track 23 (v3) — public landing page at `/`.
 *
 * Server component. If the visitor already has an active Supabase session we
 * forward straight to /dashboard (preserving the v1 behavior). Otherwise we
 * render a real cold-arrival landing page in the established Bryan-Johnson
 * "Don't Die" / minimalist serif numerals + glass aesthetic — the same
 * vocabulary as `(app)/dashboard/DashboardContent.tsx` and the auth screens.
 *
 * Sections, top-to-bottom:
 *   1. Hero          — dateline eyebrow + serif headline + two CTAs.
 *   2. Numerals      — six BiometricsCard-style stat tiles with mock numbers.
 *   3. Sources       — the eight integrations rendered as SourceChips.
 *   4. Mock readiness + recovery_note — what the deliverable looks like.
 *   5. "What we anchor to" — Blueprint references reframed as bullets.
 *   6. Bottom CTA    — sign up, plus a smaller "run the demo" link.
 *   7. Footer        — license + repo links.
 *
 * Deliberate constraints: text-only (no images, no extra fonts), every
 * visual flourish is a CSS gradient or pseudo-element. No client JS needed —
 * it's a single server-rendered HTML page.
 */

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  // The dateline echo on the hero — same `MM / DD / YYYY` numerals the
  // dashboard uses, computed server-side so the cold-arrival page reads
  // already-anchored on today's date instead of a generic "Today".
  const today = new Date();
  const dateLine = `${String(today.getMonth() + 1).padStart(2, '0')} / ${String(today.getDate()).padStart(2, '0')} / ${today.getFullYear()}`;

  return (
    <div className="relative min-h-full">
      {/* Hairline frame — clinical chart border, same trick as the auth shell */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-3 z-0 rounded-[28px] border border-border/60 sm:inset-5"
      />

      {/* Backdrop blob — quiet drift behind the hero, cribbed from auth/layout */}
      <BackdropBlob />

      {/* ─── Masthead ───────────────────────────────────────────── */}
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[28px] leading-none tracking-tight text-foreground">
            Protocol
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-muted sm:inline">
            v2 · clinical
          </span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/login"
            className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-foreground sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/90 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white transition-all hover:bg-accent"
          >
            Sign up
            <ArrowRight size={11} />
          </Link>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-20 sm:px-8">
        {/* ─── 1. HERO ────────────────────────────────────────── */}
        <section className="pb-14 pt-10 sm:pb-20 sm:pt-16">
          <div className="flex items-center gap-3">
            <div className="eyebrow text-accent">An AI health coach</div>
            <div className="h-px flex-1 bg-border" />
            <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.22em] text-muted/70">
              {dateLine}
            </div>
          </div>

          {/* Display headline — the serif numeral / italic emphasis pairing
              the dashboard hero uses. Two-line, very large. */}
          <h1 className="mt-5 font-serif text-[56px] leading-[0.95] tracking-tight text-foreground sm:text-[88px]">
            Today&rsquo;s plan,
            <br />
            <span className="italic text-muted">
              tuned to last night&rsquo;s recovery.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted">
            Protocol reads your watch, your CGM, your bloodwork, and your
            genome each morning, then prescribes the day&rsquo;s workout and
            three meals. One coach. Eight data sources. No supplement company
            in your inbox.
          </p>

          <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-6 py-3.5 text-sm font-semibold tracking-wide text-white shadow-[0_8px_30px_-12px_rgb(96_165_250/0.6)] transition-all hover:bg-accent"
            >
              Sign up
              <ArrowRight
                size={15}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-glass-2 px-6 py-3.5 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-glass-3"
            >
              Sign in
            </Link>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60 sm:inline">
              · or scroll to read the deliverable
            </span>
          </div>
        </section>

        {/* ─── 2. LIVE NUMERALS STRIP ────────────────────────── */}
        <section
          aria-labelledby="numerals-heading"
          className="border-t border-border pt-10"
        >
          <div className="flex items-center gap-3">
            <Activity size={12} className="text-accent" />
            <h2 id="numerals-heading" className="eyebrow">
              What Protocol tracks
            </h2>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
              sample numerals
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <NumeralTile n="01" label="HRV" value="52" suffix="ms" />
            <NumeralTile n="02" label="Sleep score" value="84" />
            <NumeralTile n="03" label="Steps" value="9.4k" />
            <NumeralTile n="04" label="Training load" value="430" />
            <NumeralTile n="05" label="Glucose TIR" value="92" suffix="%" />
            <NumeralTile n="06" label="HRV vs 30d" value="+4" suffix="ms" />
          </div>
        </section>

        {/* ─── 3. SOURCES ─────────────────────────────────────── */}
        <section
          aria-labelledby="sources-heading"
          className="mt-14 border-t border-border pt-10"
        >
          <div className="flex items-center gap-3">
            <Watch size={12} className="text-accent" />
            <h2 id="sources-heading" className="eyebrow">
              Eight data sources, one coach
            </h2>
            <span className="h-px flex-1 bg-border" />
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
            Plug in what you already wear. Protocol merges every reading into
            one row per day, picks the best signal per metric, and surfaces the
            attribution so you always know which device produced the value the
            coach is reading.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {(
              [
                { source: 'garmin' as BiometricsSource, custom: null },
                { source: 'whoop' as BiometricsSource, custom: null },
                { source: 'apple_watch' as BiometricsSource, custom: null },
                { source: 'manual' as BiometricsSource, custom: null },
                { source: null, custom: 'CGM' },
                { source: null, custom: 'Blood markers' },
                { source: null, custom: 'Cycle' },
                { source: null, custom: '23andMe' },
              ] as const
            ).map((c, i) =>
              c.source ? (
                <SourceChip key={`s-${i}`} source={c.source} size="sm" />
              ) : (
                <PseudoChip key={`p-${i}`} label={c.custom!} />
              )
            )}
          </div>
        </section>

        {/* ─── 4. MOCK READINESS + RECOVERY NOTE ──────────────── */}
        <section
          aria-labelledby="mock-heading"
          className="mt-14 border-t border-border pt-10"
        >
          <div className="flex items-center gap-3">
            <Sparkles size={12} className="text-accent" />
            <h2 id="mock-heading" className="eyebrow">
              The deliverable
            </h2>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
              sample
            </span>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {/* Mock readiness — same shape as ReadinessHeroCard */}
            <div className="glass-strong rounded-2xl p-5 lg:col-span-2">
              <div className="flex items-center gap-2">
                <Activity size={12} className="text-muted" />
                <span className="eyebrow">Readiness</span>
                <span className="rounded-full border border-fiber/30 bg-fiber-light px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fiber">
                  · ready
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted/60">
                  · personalized
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-serif text-[64px] leading-none tabular-nums text-fiber">
                  84
                </span>
                <span className="font-mono text-xs tabular-nums text-muted/70">
                  / 100
                </span>
              </div>
              <p className="mt-3 max-w-md font-serif text-sm italic leading-snug text-muted">
                HRV up 4ms vs your 30-day baseline; sleep score 86 with
                95-minute deep + REM. Push the prescribed intensity.
              </p>
              <div className="mt-5 space-y-2 border-t border-border pt-4">
                <MockBar label="Sleep" value={88} caption="86 score" />
                <MockBar label="HRV" value={86} caption="52ms · 30d med 48" />
                <MockBar label="Resting HR" value={78} caption="51bpm · 30d med 53" />
                <MockBar label="Stress" value={72} caption="22" />
              </div>
            </div>

            {/* Mock briefing recovery note + workout snippet */}
            <div className="glass relative overflow-hidden rounded-2xl p-5 lg:col-span-3">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
              />
              <div className="eyebrow">Today&rsquo;s plan</div>
              <div className="mb-4 mt-1 font-serif text-[28px] leading-none tracking-tight text-foreground">
                Daily <span className="italic text-muted">briefing</span>
              </div>

              {/* Recovery note — accent-bordered card, mirroring BriefingCard */}
              <section className="rounded-xl border border-accent/20 bg-accent-light p-4">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  <Heart size={11} /> Recovery note
                </div>
                <p className="mt-2 font-serif text-base leading-relaxed text-foreground">
                  &ldquo;Solid recovery — HRV at 52ms is 4ms above your 30-day
                  median, sleep score 86, deep + REM hit 95min. Run the
                  prescribed tempo intervals at threshold; cap caffeine before
                  10am given your slow CYP1A2 metabolizer flag.&rdquo;
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                    Signals from
                  </span>
                  <SourceChip source="garmin" />
                  <SourceChip source="whoop" />
                </div>
              </section>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <MockMeta label="Workout" value="Tempo 5×4min" />
                <MockMeta label="Duration" value="45 min" />
                <MockMeta label="Macros" value="2,180 kcal · 165P" />
              </div>
            </div>
          </div>
        </section>

        {/* ─── 5. "WHAT WE ANCHOR TO" — Blueprint references ──── */}
        <section
          aria-labelledby="anchor-heading"
          className="mt-14 grid gap-6 border-t border-border pt-10 lg:grid-cols-5"
        >
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <Sparkles size={12} className="text-accent" />
              <h2 id="anchor-heading" className="eyebrow">
                What we anchor to
              </h2>
            </div>
            <h3 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-[40px]">
              Specific numbers,
              <br />
              <span className="italic text-muted">not generic adjectives.</span>
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Protocol cites Bryan Johnson&rsquo;s &ldquo;Don&rsquo;t Die&rdquo;
              Blueprint defaults when you don&rsquo;t have your own targets,
              then drifts toward your personal baseline as your history fills
              in.
            </p>
          </div>
          <ul className="space-y-3 lg:col-span-3">
            <Anchor n="01" target="≥ 7h" label="Sleep duration" />
            <Anchor n="02" target="≥ 90min" label="Deep + REM combined" />
            <Anchor n="03" target="stable or up" label="HRV vs 30-day baseline" />
            <Anchor n="04" target="< 60bpm athletic · < 50 well-trained" label="Resting heart rate" />
            <Anchor n="05" target="≥ 8,000 floor · 10k target" label="Daily steps" />
            <Anchor n="06" target="90min Z2 + 75min vigorous · weekly" label="Aerobic volume" />
            <Anchor n="07" target="1g/lb bodyweight" label="Daily protein" />
            <Anchor n="08" target="30g floor · 40g target" label="Daily fiber" />
          </ul>
        </section>

        {/* ─── 6. BOTTOM CTA ─────────────────────────────────── */}
        <section className="mt-14 border-t border-border pt-10">
          <div className="glass-strong rounded-2xl p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="eyebrow text-accent">Begin onboarding</div>
              <div className="h-px flex-1 bg-border" />
            </div>
            <h2 className="mt-3 font-serif text-[36px] leading-[1] tracking-tight text-foreground sm:text-[52px]">
              Sign up to start.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Two-minute setup. Connect a watch (or skip). Optionally upload a
              23andMe raw file and a recent blood panel. The first briefing
              arrives the next morning.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="group inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/90 px-6 py-3.5 text-sm font-semibold tracking-wide text-white shadow-[0_8px_30px_-12px_rgb(96_165_250/0.6)] transition-all hover:bg-accent"
              >
                Sign up
                <ArrowRight
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-accent"
              >
                <Sparkles size={12} />
                or run the demo
              </Link>
            </div>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
              The demo populates a logged-in account with 90 days of data in
              one click — visit Settings after signing in.
            </p>
          </div>
        </section>

        {/* ─── 7. FOOTER ─────────────────────────────────────── */}
        <footer className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-[10px] font-mono uppercase tracking-[0.22em] text-muted/70 sm:flex-row sm:items-center">
          <span>Protocol · v2 · clinical</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/enricoxpioppi98/protocol/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              MIT licensed
            </a>
            <a
              href="https://github.com/enricoxpioppi98/protocol"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <Code2 size={11} />
              Source
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

/**
 * Reused decorative blob from the auth layout — same SVG, same animation.
 * The single deliberately "abstract" element on the page; everything else is
 * disciplined glass + grain.
 */
function BackdropBlob() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 900"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id="lp-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="80" />
        </filter>
        <radialGradient id="lp-grad-a" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(96,165,250)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="rgb(96,165,250)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lp-grad-b" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(168,138,248)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="rgb(168,138,248)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lp-grad-c" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(245,184,90)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="rgb(245,184,90)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g
        filter="url(#lp-blur)"
        style={{
          animation: 'blobDrift 22s ease-in-out infinite',
          transformOrigin: 'center',
        }}
      >
        <ellipse cx="900" cy="220" rx="380" ry="280" fill="url(#lp-grad-a)" />
        <ellipse cx="220" cy="700" rx="420" ry="320" fill="url(#lp-grad-b)" />
        <ellipse cx="600" cy="450" rx="260" ry="200" fill="url(#lp-grad-c)" />
      </g>
    </svg>
  );
}

/**
 * One numeral tile in the live-strip — modeled on BiometricsCard's `Stat`
 * component but flattened so it can render as plain markup. Two-line
 * eyebrow + index, then a 28px tabular-nums numeral with optional unit.
 */
function NumeralTile({
  n,
  label,
  value,
  suffix,
}: {
  n: string;
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow truncate">{label}</div>
        <span className="font-mono text-[9px] tabular-nums tracking-wider text-muted/40">
          {n}
        </span>
      </div>
      <div className="mt-2 flex items-baseline">
        <span className="font-mono text-[28px] font-medium leading-none tabular-nums text-foreground">
          {value}
        </span>
        {suffix ? (
          <span className="ml-1 font-mono text-[10px] uppercase tracking-widest text-muted/70">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Source-chip-style pill for sources that aren't backed by `BiometricsSource`
 * (CGM, blood markers, cycle, 23andMe). Same visual rhythm — glass-2
 * background, mono-uppercase text, hairline neutral border — but using a
 * neutral color since these are aggregate categories, not specific brands.
 */
function PseudoChip({ label }: { label: string }) {
  // The catalog icons clarify which signal type each pseudo-chip stands for
  // without bloating the visual rhythm. Match by label so the right glyph
  // pairs with each non-`BiometricsSource` signal type.
  let Icon: React.ComponentType<{ size?: number; className?: string }> = Droplets;
  if (label === '23andMe') Icon = Dna;
  else if (label === 'Blood markers') Icon = Droplets;
  else if (label === 'Cycle') Icon = Heart;
  else if (label === 'CGM') Icon = Droplets;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border bg-glass-2 px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.18em] text-muted backdrop-blur-sm"
      title={`Signal type: ${label}`}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}

/**
 * Mock subscore bar for the readiness preview. Mirrors the shape of
 * `ReadinessHeroCard`'s `SubscoreRow` so the landing-page card reads as the
 * same component a logged-in user will see post-signup.
 */
function MockBar({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  const fillColor =
    value >= 75 ? 'bg-fiber' : value >= 50 ? 'bg-highlight' : 'bg-danger';
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-[68px] shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/70">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-glass-2">
        <div
          className={`absolute inset-y-0 left-0 ${fillColor}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right font-mono tabular-nums text-foreground">
        {value}
      </span>
      <span className="hidden truncate font-mono text-[10px] tabular-nums text-muted/60 sm:inline">
        {caption}
      </span>
    </div>
  );
}

function MockMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-glass-1 px-3 py-2.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 truncate font-serif text-base text-foreground">{value}</div>
    </div>
  );
}

function Anchor({
  n,
  target,
  label,
}: {
  n: string;
  target: string;
  label: string;
}) {
  return (
    <li className="glass flex items-baseline gap-3 rounded-xl px-4 py-3">
      <span className="font-mono text-[10px] tabular-nums tracking-wider text-muted/50">
        {n}
      </span>
      <span className="flex-1 text-sm text-foreground">{label}</span>
      <span className="text-right font-mono text-xs tabular-nums tracking-tight text-accent">
        {target}
      </span>
    </li>
  );
}
