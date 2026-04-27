'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Trash2 } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ToolActivityChip, type ToolStatus } from './ToolActivityChip';
import { useChatHistory } from '@/lib/hooks/useChatHistory';
import type { ChatMessage as PersistedChatMessage } from '@/lib/types/models';

interface UIMessage {
  /** Stable id when known (persisted rows), undefined for the live optimistic
   *  pair while the SSE stream is in flight. */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: { id: string; name: string; status: ToolStatus }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when a tool successfully mutates the workout — parent re-fetches the briefing. */
  onWorkoutChanged: () => void;
}

const SUGGESTIONS = [
  'I only have 30 minutes today.',
  'Why this workout?',
  'Swap to a longer run instead.',
  'I’m sore — go easy.',
];

const GREETING: UIMessage = {
  role: 'assistant',
  content:
    'Hey. Ask me anything about today’s plan, or tell me what changed and I’ll rework the workout.',
};

/**
 * Deduplication strategy for optimistic vs persisted messages:
 *
 * The SSE stream and the persistence layer are intentionally independent.
 * While a turn is in flight we render an "optimistic" pair (user + assistant
 * placeholder) held in local state. When the stream ends we drop the
 * optimistic pair and fall back to whatever the server has — Realtime (or
 * the explicit refetch on stream-end) will have surfaced both rows by then.
 *
 * Render order = persisted history first, then any still-streaming optimistic
 * tail. Persisted rows have stable uuid ids; optimistic ones don't, so a
 * keyed list never collides. If Realtime is slow we briefly show duplicates;
 * the next tick reconciles. Net effect: history is authoritative once a turn
 * is complete; the optimistic pair only exists during the stream.
 */
export function ChatSlideOver({ open, onClose, onWorkoutChanged }: Props) {
  const { messages: persisted, refetch, clear } = useChatHistory();
  const [optimistic, setOptimistic] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Combine persisted history + optimistic in-flight tail. The greeting is
  // shown only when the user has zero history and nothing is streaming.
  const messages = useMemo<UIMessage[]>(() => {
    const fromHistory: UIMessage[] = persisted.map((m: PersistedChatMessage) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tools: m.tools?.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status as ToolStatus,
      })),
    }));
    if (fromHistory.length === 0 && optimistic.length === 0) {
      return [GREETING];
    }
    return [...fromHistory, ...optimistic];
  }, [persisted, optimistic]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, open]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: UIMessage = { role: 'user', content: text.trim() };
    const placeholder: UIMessage = { role: 'assistant', content: '', tools: [] };
    setOptimistic([userMsg, placeholder]);
    setInput('');
    setStreaming(true);

    // Build the API payload from already-persisted history + the new user turn.
    const apiMessages = [
      ...persisted.map((m) => ({ role: m.role, content: m.content })),
      { role: userMsg.role, content: userMsg.content },
    ].filter((m) => m.role === 'user' || m.content.length > 0);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`chat failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames separated by blank line.
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const evMatch = frame.match(/^event: (.+)$/m);
          const dataMatch = frame.match(/^data: (.+)$/m);
          if (!evMatch || !dataMatch) continue;
          const event = evMatch[1];
          let data: unknown;
          try {
            data = JSON.parse(dataMatch[1]);
          } catch {
            continue;
          }
          handleEvent(event, data);
        }
      }
    } catch (err) {
      console.error(err);
      setOptimistic((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          last.content =
            last.content + (last.content ? '\n\n' : '') + '_(connection lost)_';
        }
        return copy;
      });
    } finally {
      setStreaming(false);
      // Drop the optimistic pair — the persisted rows are now authoritative.
      // Realtime will normally have already pushed them; refetch is a belt-
      // and-suspenders fallback in case the channel is slow.
      setOptimistic([]);
      refetch();
    }
  }

  function handleEvent(event: string, data: unknown) {
    setOptimistic((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (!last || last.role !== 'assistant') return copy;
      const d = data as Record<string, unknown>;

      if (event === 'text' && typeof d.delta === 'string') {
        last.content += d.delta;
      } else if (event === 'tool_use_start') {
        last.tools = last.tools ?? [];
        last.tools.push({
          id: String(d.id),
          name: String(d.name),
          status: 'pending',
        });
      } else if (event === 'tool_executing') {
        const t = last.tools?.find((t) => t.id === String(d.id));
        if (t) t.status = 'running';
      } else if (event === 'tool_result') {
        const t = last.tools?.find((t) => t.id === String(d.id));
        if (t) t.status = d.ok ? 'success' : 'error';
        if (d.ok) onWorkoutChanged();
      } else if (event === 'error') {
        last.content +=
          (last.content ? '\n\n' : '') +
          `_(${typeof d.message === 'string' ? d.message : 'error'})_`;
      }
      return copy;
    });
  }

  async function handleClear() {
    if (streaming) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Clear all chat history? This cannot be undone.');
      if (!ok) return;
    }
    await clear();
  }

  return (
    <>
      {/* Scrim — soft frosted blur */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel — translucent glass slide-over */}
      <aside
        className={`glass-strong fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <header className="flex h-20 items-end justify-between border-b border-border px-5 pb-4">
          <div>
            <div className="eyebrow text-accent">Conversation</div>
            <h2 className="mt-0.5 font-serif text-2xl leading-none text-foreground">
              <span className="italic">Coach</span>
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleClear}
              disabled={streaming}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-glass-3 hover:text-foreground disabled:opacity-40"
              aria-label="Clear chat history"
              title="Clear chat history"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-glass-3 hover:text-foreground"
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {messages.map((m, i) => (
            <div key={m.id ?? `opt-${i}`} className="space-y-1.5">
              <MessageBubble role={m.role}>
                {m.content || (
                  m.role === 'assistant' && streaming && i === messages.length - 1 ? (
                    <span className="inline-block animate-pulse text-muted">…</span>
                  ) : null
                )}
              </MessageBubble>
              {m.tools && m.tools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pl-2">
                  {m.tools.map((t) => (
                    <ToolActivityChip key={t.id} name={t.name} status={t.status} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {messages.length <= 1 && !streaming ? (
          <div className="border-t border-border px-4 py-3">
            <div className="eyebrow mb-2">Suggestions</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border bg-glass-1 px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent/40 hover:bg-accent-light hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <form
          className="flex items-center gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming}
            placeholder="Ask about today’s plan…"
            className="flex-1 rounded-xl border border-border bg-glass-1 px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted/50 focus:border-accent/60 focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl border border-accent/40 bg-accent/90 p-2.5 text-white transition-colors hover:bg-accent disabled:opacity-50"
            aria-label="Send"
          >
            <Send size={15} />
          </button>
        </form>
      </aside>
    </>
  );
}
