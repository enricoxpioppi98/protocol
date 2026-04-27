-- Protocol v1: chat persistence
-- Stores chat messages for the AI coach slide-over so history survives
-- closing the panel. Run this in the Supabase SQL Editor after migration 004.

-- ============================================================
-- TABLES
-- ============================================================

-- CHAT_MESSAGES — one row per turn in the coach chat. The assistant row's
-- `tools` column captures the final per-tool status array so historical
-- ToolActivityChip rendering matches what the user saw during streaming.
create table public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  tools jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_chat_messages_user_created on public.chat_messages(user_id, created_at desc);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGERS
-- (set_updated_at() is defined in 001_initial_schema.sql)
-- ============================================================

create trigger trg_chat_messages_updated_at before update on public.chat_messages
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.chat_messages enable row level security;

create policy "Users can CRUD own chat_messages" on public.chat_messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- REALTIME
-- ============================================================

alter publication supabase_realtime add table public.chat_messages;
