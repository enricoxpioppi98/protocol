import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit/broker';
import { embedBatch, EmbeddingError } from '@/lib/coach/memory';
import { getAdminClient } from '@/lib/supabase/admin';
import type {
  BriefingMeal,
  BriefingWorkout,
  ChatToolCall,
} from '@/lib/types/models';

/**
 * GET/POST /api/coach/memory/reindex
 *
 * Vercel Cron entry point for the nightly memory indexer (Track 12).
 * Same auth pattern as /api/sync/cron: `Authorization: Bearer ${CRON_SECRET}`.
 *
 * For each user:
 *   1. Find chat_messages and daily_briefing rows that don't yet have a
 *      coach_memory row keyed by (user_id, source_type, source_id).
 *   2. Render each row to a single string of "what was said / planned".
 *   3. Embed in batches of 16 with OpenAI text-embedding-3-small.
 *   4. Upsert into public.coach_memory (service-role client; RLS bypassed).
 *
 * Bounded per-call by ROW_LIMIT_PER_CALL so a backfill of N months of chat
 * doesn't time out a single cron tick. Re-running the cron drains the queue.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EMBED_BATCH_SIZE = 16;
const ROW_LIMIT_PER_CALL = 200;
const PER_USER_FETCH_LIMIT = 500; // generous; we'll filter out already-indexed

interface ChatRow {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ChatToolCall[] | null;
  created_at: string;
}

interface BriefingRow {
  user_id: string;
  date: string;
  meals: BriefingMeal[] | null;
  workout: BriefingWorkout | null;
  recovery_note: string | null;
  generated_at: string;
}

interface IndexedKey {
  user_id: string;
  source_type: 'chat_message' | 'daily_briefing';
  source_id: string;
}

interface PendingItem {
  userId: string;
  sourceType: 'chat_message' | 'daily_briefing';
  sourceId: string;
  content: string;
  ts: string;
  metadata: Record<string, unknown>;
}

interface UserResult {
  user_id: string;
  rows_indexed: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === secret;
}

async function handle(req: Request): Promise<Response> {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const userIds = await listUsersWithSourceContent(admin);

  let totalIndexed = 0;
  let budgetRemaining = ROW_LIMIT_PER_CALL;
  const results: UserResult[] = [];

  for (const userId of userIds) {
    if (budgetRemaining <= 0) {
      results.push({ user_id: userId, rows_indexed: 0, status: 'skipped' });
      continue;
    }
    const started = Date.now();
    try {
      const indexed = await reindexUser(admin, userId, budgetRemaining);
      totalIndexed += indexed;
      budgetRemaining -= indexed;

      await logAudit({
        actor: userId,
        action: 'coach_memory.index.success',
        target: 'coach_memory',
        purpose: 'coach_memory_reindex',
        ts: new Date().toISOString(),
        status: 'ok',
        msElapsed: Date.now() - started,
        rowsAffected: indexed,
      });

      results.push({ user_id: userId, rows_indexed: indexed, status: 'ok' });
    } catch (err) {
      const message = errorMessageOf(err);
      await logAudit({
        actor: userId,
        action: 'coach_memory.index.error',
        target: 'coach_memory',
        purpose: 'coach_memory_reindex',
        ts: new Date().toISOString(),
        status: 'error',
        msElapsed: Date.now() - started,
        rowsAffected: 0,
        errorMessage: message,
      });
      results.push({
        user_id: userId,
        rows_indexed: 0,
        status: 'error',
        error: message,
      });
    }
  }

  return NextResponse.json({
    users_processed: results.length,
    rows_indexed: totalIndexed,
    budget_remaining: budgetRemaining,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

// ---------- per-user pipeline ----------

async function reindexUser(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  budget: number,
): Promise<number> {
  if (budget <= 0) return 0;

  // Pull recent source rows + the keys we already have indexed. We compute
  // the set difference in JS (one user = bounded row count) rather than
  // sending a NOT IN with possibly thousands of values.
  const [chatRows, briefingRows, indexedKeys] = await Promise.all([
    fetchRecentChatRows(admin, userId),
    fetchRecentBriefingRows(admin, userId),
    fetchIndexedKeys(admin, userId),
  ]);

  const indexed = new Set<string>();
  for (const k of indexedKeys) {
    indexed.add(`${k.source_type}::${k.source_id}`);
  }

  const pending: PendingItem[] = [];

  for (const row of chatRows) {
    const key = `chat_message::${row.id}`;
    if (indexed.has(key)) continue;
    const content = renderChatTurn(row);
    if (!content) continue;
    pending.push({
      userId,
      sourceType: 'chat_message',
      sourceId: row.id,
      content,
      ts: row.created_at,
      metadata: { role: row.role },
    });
    if (pending.length >= budget) break;
  }

  if (pending.length < budget) {
    for (const row of briefingRows) {
      const key = `daily_briefing::${row.date}`;
      if (indexed.has(key)) continue;
      const content = renderBriefing(row);
      if (!content) continue;
      pending.push({
        userId,
        sourceType: 'daily_briefing',
        sourceId: row.date,
        content,
        ts: row.generated_at ?? `${row.date}T00:00:00Z`,
        metadata: { date: row.date },
      });
      if (pending.length >= budget) break;
    }
  }

  if (pending.length === 0) return 0;

  let inserted = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedBatch(batch.map((b) => b.content));

    const upsertRows = batch.map((b, idx) => ({
      user_id: b.userId,
      source_type: b.sourceType,
      source_id: b.sourceId,
      content: b.content,
      metadata: b.metadata,
      embedding: vectorToLiteral(vectors[idx]),
      ts: b.ts,
      indexed_at: new Date().toISOString(),
    }));

    const { error } = await admin
      .from('coach_memory')
      .upsert(upsertRows, { onConflict: 'user_id,source_type,source_id' });

    if (error) {
      throw new EmbeddingError(
        `coach_memory upsert failed: ${error.message}`,
      );
    }
    inserted += batch.length;
  }
  return inserted;
}

// ---------- queries ----------

async function listUsersWithSourceContent(
  admin: ReturnType<typeof getAdminClient>,
): Promise<string[]> {
  const ids = new Set<string>();
  const [chat, briefing] = await Promise.all([
    admin.from('chat_messages').select('user_id').limit(10000),
    admin.from('daily_briefing').select('user_id').limit(10000),
  ]);
  for (const row of (chat.data ?? []) as Array<{ user_id: string }>) {
    ids.add(row.user_id);
  }
  for (const row of (briefing.data ?? []) as Array<{ user_id: string }>) {
    ids.add(row.user_id);
  }
  return Array.from(ids);
}

async function fetchRecentChatRows(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<ChatRow[]> {
  const { data, error } = await admin
    .from('chat_messages')
    .select('id, user_id, role, content, tools, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(PER_USER_FETCH_LIMIT);
  if (error) throw new Error(`chat_messages fetch: ${error.message}`);
  return (data ?? []) as ChatRow[];
}

async function fetchRecentBriefingRows(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<BriefingRow[]> {
  const { data, error } = await admin
    .from('daily_briefing')
    .select('user_id, date, meals, workout, recovery_note, generated_at')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(PER_USER_FETCH_LIMIT);
  if (error) throw new Error(`daily_briefing fetch: ${error.message}`);
  return (data ?? []) as BriefingRow[];
}

async function fetchIndexedKeys(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<IndexedKey[]> {
  const { data, error } = await admin
    .from('coach_memory')
    .select('user_id, source_type, source_id')
    .eq('user_id', userId);
  if (error) throw new Error(`coach_memory fetch: ${error.message}`);
  return (data ?? []) as IndexedKey[];
}

// ---------- rendering ----------

/**
 * Turn a chat_messages row into a single string suitable for embedding +
 * later display. Keep role tags so similarity search can distinguish "user
 * complained about hip pain" from "assistant suggested squats".
 */
function renderChatTurn(row: ChatRow): string {
  const text = (row.content ?? '').trim();
  if (!text) return '';
  const tag = row.role === 'user' ? 'User' : 'Coach';
  return `${tag}: ${text}`;
}

/**
 * Turn a daily_briefing row into a single string. Includes the recovery note,
 * the workout headline + blocks, and the meal slots — the bits a coach would
 * actually cite later ("on 04/12 we programmed box step-ups…").
 */
function renderBriefing(row: BriefingRow): string {
  const parts: string[] = [`Briefing for ${row.date}.`];

  if (row.recovery_note && row.recovery_note.trim()) {
    parts.push(`Recovery: ${row.recovery_note.trim()}`);
  }

  const w = row.workout;
  if (w && w.name) {
    const header = `Workout: ${w.name} (${w.duration_minutes ?? '?'}min)`;
    const blocks =
      Array.isArray(w.blocks) && w.blocks.length > 0
        ? w.blocks
            .map((b) => {
              const bits = [b.name];
              if (b.sets) bits.push(`${b.sets} sets`);
              if (b.reps) bits.push(b.reps);
              if (b.intensity) bits.push(b.intensity);
              return bits.filter(Boolean).join(' ');
            })
            .join('; ')
        : '';
    parts.push(blocks ? `${header} — ${blocks}` : header);
  }

  if (Array.isArray(row.meals) && row.meals.length > 0) {
    const meals = row.meals
      .map((m) => `${m.slot}: ${m.name}`)
      .join('; ');
    parts.push(`Meals: ${meals}`);
  }

  return parts.join(' ');
}

// ---------- internals ----------

function vectorToLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}
