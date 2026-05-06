/**
 * Tiny browser-side SSE reader. The Anthropic-style server streams events
 * with `event: <name>\ndata: <json>\n\n` framing; this helper consumes a
 * `Response.body` ReadableStream from a `fetch()` call and yields parsed
 * events one at a time.
 *
 * EventSource would be simpler but only supports GET requests; our
 * streaming routes are POST (so the server can take a body + read auth).
 */

export interface SSEEvent {
  event: string;
  data: unknown;
}

export async function* readSSE(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent, void, void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        try {
          reader.cancel();
        } catch {
          // already cancelled
        }
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line ("\n\n").
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

function parseFrame(frame: string): SSEEvent | null {
  let event = 'message';
  let dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    if (!rawLine || rawLine.startsWith(':')) continue; // comment / heartbeat
    const colon = rawLine.indexOf(':');
    if (colon === -1) continue;
    const field = rawLine.slice(0, colon);
    let value = rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // leave as string
  }
  return { event, data };
}

/**
 * Extract the (possibly partial) value of a top-level string field from a
 * JSON-being-built string. Handles JSON escapes (`\\n`, `\\"`, `\\\\`).
 *
 * Returns null when the field hasn't been opened yet. Returns the partial
 * value once the opening `"` has appeared, even if the closing quote hasn't
 * arrived. This is what powers the live token-by-token render of
 * `recovery_note` while Claude is still emitting input_json_delta events.
 */
export function extractStringField(
  partialJson: string,
  field: string
): string | null {
  // Match the opening `"field":"<value>` — `<value>` can include any non-quote
  // chars OR escaped sequences like \" \\ \n etc. We deliberately don't
  // require a closing quote — partial reads are the whole point.
  const fieldRe = new RegExp(
    `"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`
  );
  const match = fieldRe.exec(partialJson);
  if (!match) return null;
  return unescapeJsonString(match[1]);
}

function unescapeJsonString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) {
      // Trailing backslash mid-stream — drop it; next chunk will complete it.
      break;
    }
    i++;
    switch (next) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'u': {
        // \uXXXX — only emit when we have all 4 hex digits, else stop.
        const hex = raw.slice(i + 1, i + 5);
        if (hex.length < 4) return out;
        const code = parseInt(hex, 16);
        if (Number.isFinite(code)) out += String.fromCharCode(code);
        i += 4;
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}
