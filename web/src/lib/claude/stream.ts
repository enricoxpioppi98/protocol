/**
 * Server-Sent-Events helpers for streaming Claude output to the browser.
 *
 * The event vocabulary mirrors HELIX's ConversationSession.swift so the
 * client-side state machine has the same shape on both platforms (today TS,
 * later Swift when the iOS app catches up in v2).
 *
 * Events emitted:
 *   - text          : Claude streamed a text delta. data: {delta: string}
 *   - tool_use_start: Claude began emitting a tool call. data: {id, name}
 *   - tool_input_delta: partial JSON for the tool input. data: {id, partial_json}
 *   - tool_executing: server is running the tool. data: {id, name}
 *   - tool_result   : tool execution finished. data: {id, ok, result}
 *   - error         : something went wrong. data: {message}
 *   - done          : end of the response. data: {}
 */

export interface SSEController {
  emit(event: string, data: unknown): void;
  close(): void;
}

export function makeSSEStream(): { stream: ReadableStream<Uint8Array>; controller: SSEController } {
  const encoder = new TextEncoder();
  let writer: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      writer = c;
    },
    cancel() {
      closed = true;
    },
  });

  const controller: SSEController = {
    emit(event, data) {
      if (closed || !writer) return;
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      try {
        writer.enqueue(encoder.encode(payload));
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed || !writer) return;
      closed = true;
      try {
        writer.close();
      } catch {
        // already closed
      }
    },
  };

  return { stream, controller };
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
