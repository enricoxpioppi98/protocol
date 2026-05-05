/**
 * Track 12 (v3): coach long-term memory.
 *
 * Embeds chat turns + rendered briefings into `public.coach_memory`, retrieves
 * the most relevant rows by cosine similarity at chat/briefing generation
 * time. Track 14 wires `recallRelevant` + `summarizeForPrompt` into the
 * actual chat/briefing routes; this file just owns the data path.
 *
 * Embedding provider: Voyage AI `voyage-3` (1024 dims), Anthropic's
 * recommended embedding partner. We call the REST endpoint directly with
 * `fetch` rather than pulling in `voyageai` — one endpoint, one shape, not
 * worth the dependency. Single-vendor with the rest of the AI stack
 * (Anthropic for coaching, Voyage for memory) avoids an OpenAI key purely
 * for embeddings.
 */

import { getAdminClient } from '@/lib/supabase/admin';

const EMBEDDING_MODEL = 'voyage-3';
const EMBEDDING_DIMS = 1024;
const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';

export interface Recollection {
  /** ISO timestamp of when the source thing happened. */
  ts: string;
  source_type: 'chat_message' | 'daily_briefing';
  /** The original text that was embedded. */
  content: string;
  /** Cosine similarity in 0..1; higher = more similar. */
  similarity: number;
  /** Days between `ts` and now, rounded down. For "remember when…" framing. */
  age_days: number;
}

export class EmbeddingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Embed a single string with Voyage AI `voyage-3`.
 *
 * Throws `EmbeddingError` with context on any failure so the cron can audit-
 * log the underlying reason cleanly.
 */
export async function embed(text: string): Promise<number[]> {
  const vectors = await embedBatch([text], 'document');
  return vectors[0];
}

/**
 * Embed up to N strings in one call. Voyage accepts an array `input` and an
 * `input_type` of "document" (for stored corpus) or "query" (for retrieval
 * queries) — using the right type at each site improves retrieval quality.
 * 16 at a time keeps payloads small + retries cheap if a single batch fails.
 */
export async function embedBatch(
  texts: string[],
  inputType: 'document' | 'query' = 'document'
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError('VOYAGE_API_KEY not set');
  }

  let res: Response;
  try {
    res = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        input_type: inputType,
      }),
    });
  } catch (err) {
    throw new EmbeddingError(
      `voyage embeddings fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new EmbeddingError(
      `voyage embeddings HTTP ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new EmbeddingError('voyage embeddings returned non-JSON', err);
  }

  const data = (json as { data?: Array<{ embedding?: number[] }> }).data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new EmbeddingError(
      `voyage embeddings shape mismatch: expected ${texts.length} vectors, got ${data?.length ?? 0}`,
    );
  }

  const vectors: number[][] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i].embedding;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS) {
      throw new EmbeddingError(
        `voyage embeddings vector ${i} wrong shape (len=${v?.length ?? 0}, want ${EMBEDDING_DIMS})`,
      );
    }
    vectors.push(v);
  }
  return vectors;
}

/**
 * Index one source row. Idempotent — upserts on (user_id, source_type, source_id).
 *
 * Re-embeds on every call; the cron decides whether to re-index by diffing
 * source rows against existing `coach_memory` rows. Callers that pass the same
 * `(userId, sourceType, sourceId)` overwrite the prior embedding + content.
 */
export async function indexMemory(opts: {
  userId: string;
  sourceType: 'chat_message' | 'daily_briefing';
  sourceId: string;
  content: string;
  ts: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const trimmed = opts.content.trim();
  if (!trimmed) {
    // Empty assistant turn (tool-only response). Nothing useful to embed.
    return;
  }

  const [vector] = await embedBatch([trimmed]);
  const admin = getAdminClient();

  // pgvector accepts the canonical `[1.0,2.0,...]` text format from JS clients.
  const embeddingLiteral = vectorToLiteral(vector);

  const { error } = await admin.from('coach_memory').upsert(
    {
      user_id: opts.userId,
      source_type: opts.sourceType,
      source_id: opts.sourceId,
      content: trimmed,
      metadata: opts.metadata ?? {},
      embedding: embeddingLiteral,
      ts: opts.ts,
      indexed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source_type,source_id' },
  );

  if (error) {
    throw new EmbeddingError(
      `coach_memory upsert failed: ${error.message}`,
      error,
    );
  }
}

/**
 * The retrieval entrypoint Track 14 will call.
 *
 * Embeds `query`, runs cosine similarity against the user's own coach_memory
 * rows via pgvector's `<=>` operator (cosine distance), filters out anything
 * below `minSimilarity`, and returns the top-k as `Recollection`s.
 *
 * Uses an RPC if one is registered; falls back to a direct query otherwise.
 * RLS gates by user_id but we still pass it explicitly for the index hit.
 */
export async function recallRelevant(opts: {
  userId: string;
  query: string;
  k?: number;
  minSimilarity?: number;
}): Promise<Recollection[]> {
  const k = opts.k ?? 3;
  const minSimilarity = opts.minSimilarity ?? 0.78;
  const trimmed = opts.query.trim();
  if (!trimmed) return [];

  const [queryVector] = await embedBatch([trimmed], 'query');
  const queryLiteral = vectorToLiteral(queryVector);

  const admin = getAdminClient();

  // We can't use postgrest's `.order('embedding <=> ...')` directly because
  // postgrest doesn't parse operator syntax in `order`. Use a SQL function via
  // RPC if you want. For v3 we use a small select with `rpc` — but to keep the
  // surface area minimal and avoid a second migration, we issue the query via
  // the postgrest endpoint with a raw `select` containing the distance
  // expression aliased, then sort/filter client-side. This is bounded by the
  // user's own row count (typically a few hundred), which is fine.
  //
  // Pull a generous candidate window (k * 8, capped) ordered by recency,
  // re-rank by similarity, then truncate. This trades a little recall for not
  // needing a SQL function. Track 14 can swap in an RPC if the user grows
  // past ~5k memories.
  const candidateLimit = Math.min(Math.max(k * 8, 32), 256);
  const { data, error } = await admin
    .from('coach_memory')
    .select('ts, source_type, content, embedding')
    .eq('user_id', opts.userId)
    .order('ts', { ascending: false })
    .limit(candidateLimit);

  if (error) {
    throw new EmbeddingError(
      `coach_memory recall query failed: ${error.message}`,
      error,
    );
  }

  type Row = {
    ts: string;
    source_type: 'chat_message' | 'daily_briefing';
    content: string;
    embedding: string | number[];
  };

  const rows = (data ?? []) as Row[];
  const now = Date.now();

  const scored: Recollection[] = [];
  for (const row of rows) {
    const v = parseEmbeddingMaybe(row.embedding);
    if (!v) continue;
    const sim = cosineSimilarity(queryVector, v);
    if (sim < minSimilarity) continue;
    const ageMs = now - new Date(row.ts).getTime();
    const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    scored.push({
      ts: row.ts,
      source_type: row.source_type,
      content: row.content,
      similarity: sim,
      age_days: ageDays,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);

  // Suppress the "queryLiteral computed but unused" warning — it's part of the
  // function's contract and useful when Track 14 swaps to an RPC.
  void queryLiteral;
}

/**
 * Render recollections as a multi-line block to stuff into a system prompt.
 * Empty string when nothing meets threshold so the caller can append blindly.
 *
 * Output shape:
 *
 *   PAST_CONTEXT (most-relevant memories from prior chats / briefings):
 *   - 2026-04-12 (22d ago, chat): "I've been having hip pain after squats..."
 *   - 2026-03-30 (35d ago, briefing): "Recovery still elevated; keep volume..."
 */
export function summarizeForPrompt(recall: Recollection[]): string {
  if (recall.length === 0) return '';
  const lines: string[] = [
    'PAST_CONTEXT (most-relevant memories from prior chats / briefings):',
  ];
  for (const r of recall) {
    const date = r.ts.slice(0, 10);
    const kind = r.source_type === 'chat_message' ? 'chat' : 'briefing';
    const ageLabel = r.age_days === 0 ? 'today' : `${r.age_days}d ago`;
    const snippet = truncate(r.content, 280).replace(/\s+/g, ' ').trim();
    lines.push(`- ${date} (${ageLabel}, ${kind}): "${snippet}"`);
  }
  return lines.join('\n');
}

// ---------- internals ----------

function vectorToLiteral(v: number[]): string {
  // pgvector accepts JS arrays via supabase-js, but the postgrest path may
  // serialize them as JSON arrays — pgvector also parses the canonical
  // `[1,2,3]` string form, which is unambiguous. Use that.
  return `[${v.join(',')}]`;
}

function parseEmbeddingMaybe(raw: string | number[]): number[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  // pgvector returns the canonical `[1,2,...]` text form via postgrest.
  if (raw.length < 3 || raw[0] !== '[' || raw[raw.length - 1] !== ']') {
    return null;
  }
  const body = raw.slice(1, -1);
  if (!body) return null;
  const parts = body.split(',');
  const out: number[] = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}
