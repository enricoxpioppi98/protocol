-- Track 12 (v3): coach long-term memory (RAG).
-- One row per memorable thing (chat turn, briefing). Indexed by the nightly
-- /api/coach/memory/reindex cron, retrieved at chat/briefing generation time
-- (Track 14) by cosine similarity over the user's own rows.
--
-- Embedding provider: Voyage AI `voyage-3` (1024 dims), Anthropic's
-- recommended embedding partner. Single-vendor with the rest of the AI
-- stack — no OpenAI key needed purely for embeddings. Configure via
-- VOYAGE_API_KEY env var.
--
-- pgvector ships in Supabase Postgres; no new infra. Cosine distance via the
-- `<=>` operator; similarity = 1 - distance.

create extension if not exists vector;

create table public.coach_memory (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  source_type  text not null check (source_type in ('chat_message','daily_briefing')),
  source_id    text not null,           -- the source table's PK as text
  content      text not null,           -- what was embedded
  metadata     jsonb not null default '{}'::jsonb,
  embedding    vector(1024) not null,
  ts           timestamptz not null,    -- when the source thing happened
  indexed_at   timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create index coach_memory_user_ts_idx
  on public.coach_memory (user_id, ts desc);

-- ivfflat needs ANALYZE after bulk insert for the optimizer to pick the index.
-- 100 lists is a reasonable default for low-thousands of rows per user.
create index coach_memory_embedding_ivfflat
  on public.coach_memory using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.coach_memory enable row level security;

-- Users can read their own memory. No INSERT/UPDATE/DELETE policy is declared,
-- so only the service-role client (which bypasses RLS) can write — matching
-- the audit_ledger pattern in 014.
create policy "Users can read own coach_memory"
  on public.coach_memory
  for select
  using (auth.uid() = user_id);
