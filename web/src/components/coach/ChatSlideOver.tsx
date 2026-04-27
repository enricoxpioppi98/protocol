'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ToolActivityChip, type ToolStatus } from './ToolActivityChip';

interface ChatMessage {
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

export function ChatSlideOver({ open, onClose, onWorkoutChanged }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content:
            'Hey. Ask me anything about today’s plan, or tell me what changed and I’ll rework the workout.',
        },
      ]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const placeholder: ChatMessage = { role: 'assistant', content: '', tools: [] };
    setMessages((m) => [...m, userMsg, placeholder]);
    setInput('');
    setStreaming(true);

    const apiMessages = [...messages, userMsg]
      .filter((m) => m.role === 'user' || m.content.length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

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
      setMessages((m) => {
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
    }
  }

  function handleEvent(event: string, data: unknown) {
    setMessages((m) => {
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

  return (
    <>
      {/* Scrim */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <header className="flex h-16 items-center justify-between border-b border-border px-5">
          <h2 className="text-base font-semibold text-foreground">Coach</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
            aria-label="Close chat"
          >
            <X size={18} />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((m, i) => (
            <div key={i} className="space-y-1.5">
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
          <div className="border-t border-border px-4 py-2">
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full bg-card-hover px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent-light hover:text-accent"
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
            className="flex-1 rounded-xl bg-background px-3 py-2 text-sm text-foreground outline-none ring-1 ring-border transition-shadow focus:ring-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-accent p-2 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </form>
      </aside>
    </>
  );
}
