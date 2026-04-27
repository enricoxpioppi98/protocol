'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ChatMessage } from '@/lib/types/models';

/**
 * useChatHistory — load + subscribe to the signed-in user's persisted chat
 * messages. The SSE chat route writes rows on user-send and on stream-end;
 * Realtime fans those writes back into the UI without a manual refetch.
 */
export function useChatHistory() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/chat/history', { cache: 'no-store' });
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const json = (await res.json()) as { messages?: ChatMessage[] };
      setMessages(json.messages ?? []);
    } catch (err) {
      console.error('[useChatHistory] fetch failed', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Realtime: any insert/update/delete on chat_messages triggers a refetch.
  // RLS already constrains rows to the current user, so we don't need to
  // filter further here.
  useEffect(() => {
    const channel = supabase
      .channel('chat_messages_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refetch]);

  const clear = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/history', { method: 'DELETE' });
      if (!res.ok) return;
    } catch (err) {
      console.error('[useChatHistory] clear failed', err);
      return;
    }
    await refetch();
  }, [refetch]);

  return { messages, loading, refetch, clear };
}
