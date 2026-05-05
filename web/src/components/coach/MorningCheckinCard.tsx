'use client';

import { useEffect, useState } from 'react';
import { Send, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Wave 4 — Morning checkin card.
 *
 * On dashboard mount, GETs `/api/coach/morning-checkin` which lazily
 * generates today's question if missing. Renders a single tight question
 * with up to 3 quick-reply chips + a free-text fallback. After the user
 * answers, fires `onAnswered` so the parent can regenerate the briefing
 * with the answer in context.
 *
 * Silent in three cases (no card rendered):
 *   1. The endpoint hasn't returned yet (loading).
 *   2. Today's checkin is already answered.
 *   3. The user dismissed it for today (localStorage).
 */

export interface MorningCheckin {
  user_id: string;
  date: string;
  question_text: string;
  quick_replies: string[];
  rationale: string | null;
  answer_text: string | null;
  answer_quick_reply_index: number | null;
  answered_at: string | null;
  generated_at: string;
}

const DISMISS_KEY = (date: string) => `morning_checkin_dismissed_${date}`;

export function MorningCheckinCard({ onAnswered }: { onAnswered?: () => void }) {
  const [checkin, setCheckin] = useState<MorningCheckin | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [draft, setDraft] = useState('');
  const [thanksMessage, setThanksMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/coach/morning-checkin', { method: 'GET' });
        if (!res.ok) return;
        const data = (await res.json()) as { checkin?: MorningCheckin };
        if (cancelled || !data.checkin) return;
        setCheckin(data.checkin);
        if (typeof window !== 'undefined') {
          setDismissed(
            window.localStorage.getItem(DISMISS_KEY(data.checkin.date)) === '1'
          );
        }
      } catch (err) {
        console.warn('[MorningCheckinCard] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !checkin) return null;
  if (checkin.answered_at && !thanksMessage) return null;
  if (dismissed) return null;

  async function submit(payload: {
    answer_text?: string;
    answer_quick_reply_index?: number;
  }) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/coach/morning-checkin/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[MorningCheckinCard] submit failed', err);
        return;
      }
      const data = (await res.json()) as { checkin: MorningCheckin };
      setCheckin(data.checkin);
      setThanksMessage('Thanks — adjusting today’s plan.');
      // Hand control back so the parent can regenerate the briefing with the
      // answer in context. We hold the card visible for ~2.5s with the
      // thanks line so the user sees the loop close.
      onAnswered?.();
      setTimeout(() => setThanksMessage(null), 2500);
    } finally {
      setSubmitting(false);
    }
  }

  function dismiss() {
    if (typeof window !== 'undefined' && checkin) {
      window.localStorage.setItem(DISMISS_KEY(checkin.date), '1');
    }
    setDismissed(true);
  }

  return (
    <div className="glass-strong relative rounded-2xl p-5 animate-[fadeIn_0.4s_ease-out]">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss morning checkin"
        className="absolute right-3 top-3 text-muted/60 transition-colors hover:text-foreground"
      >
        <X size={14} />
      </button>

      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={14} />
        </span>
        <span className="eyebrow">Morning checkin</span>
      </div>

      <p className="mt-3 font-serif text-xl leading-snug text-foreground">
        {checkin.question_text}
      </p>

      {thanksMessage ? (
        <p className="mt-4 text-sm text-accent" role="status" aria-live="polite">
          {thanksMessage}
        </p>
      ) : (
        <>
          {checkin.quick_replies.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {checkin.quick_replies.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={submitting}
                  onClick={() => submit({ answer_quick_reply_index: i })}
                  className={cn(
                    'rounded-full border border-border bg-glass-2 px-3 py-1.5 text-sm text-foreground transition-colors',
                    'hover:bg-glass-3 disabled:opacity-50'
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed) return;
              submit({ answer_text: trimmed });
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                checkin.quick_replies.length > 0
                  ? 'Or type a reply…'
                  : 'Type a reply…'
              }
              disabled={submitting}
              className={cn(
                'flex-1 rounded-xl border border-border bg-glass-1 px-3 py-2 text-sm text-foreground outline-none transition-colors',
                'focus:border-accent/60 focus:ring-1 focus:ring-accent/40 disabled:opacity-60'
              )}
            />
            <button
              type="submit"
              disabled={submitting || !draft.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent/90 disabled:opacity-40"
              aria-label="Submit reply"
            >
              <Send size={14} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
