'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/onboarding');
      router.refresh();
    }
  }

  return (
    <div className="w-full max-w-[380px]">
      <div className="eyebrow text-accent">New protocol</div>

      <h1 className="mt-3 font-serif text-[56px] leading-[0.95] tracking-tight text-foreground sm:text-[68px]">
        A coach
        <br />
        <span className="italic text-muted">for one.</span>
      </h1>

      <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
        Protocol reads your sleep, HRV, and macros each morning, then tunes the
        day&rsquo;s workout and meals to match. Two-minute setup.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-4">
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger backdrop-blur-md">
            {error}
          </div>
        )}

        <Field
          id="email"
          n="01"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
        />
        <Field
          id="password"
          n="02"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 6 characters"
        />
        <Field
          id="confirmPassword"
          n="03"
          label="Confirm"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Repeat password"
        />

        <button
          type="submit"
          disabled={loading}
          className="group relative mt-2 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-accent/40 bg-accent/90 px-5 py-3.5 text-sm font-semibold tracking-wide text-white shadow-[0_8px_30px_-12px_rgb(96_165_250/0.6)] transition-all hover:bg-accent disabled:opacity-50"
        >
          <span>{loading ? 'Creating account…' : 'Begin onboarding'}</span>
          <ArrowRight
            size={15}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </button>
      </form>

      <div className="mt-8 flex items-center gap-3 text-xs">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono uppercase tracking-[0.22em] text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <p className="mt-8 text-center text-sm text-muted">
        Already enrolled?{' '}
        <Link
          href="/login"
          className="font-medium text-foreground underline decoration-accent decoration-1 underline-offset-4 transition-colors hover:text-accent"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

function Field({
  id,
  n,
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  n: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label htmlFor={id} className="group block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-[10px] tracking-wider text-muted/50">{n}</span>
      </div>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        placeholder={placeholder}
        className="block w-full rounded-xl border border-border bg-glass-2 px-4 py-3.5 font-mono text-sm tracking-wide text-foreground backdrop-blur-md placeholder:text-muted/40 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </label>
  );
}
