-- Protocol: Apple Watch / HealthKit integration via iOS Shortcut webhook.
--
-- Browsers cannot read HealthKit directly, but an iOS Shortcut can. The user
-- provisions a per-account bearer token in /settings/integrations/apple-watch,
-- pastes it into a Shortcut on their iPhone, and the Shortcut POSTs a HealthKit
-- JSON payload to /api/biometrics/apple-watch every morning.
--
-- We store only a SHA-256 hash of the token. The raw token is shown to the
-- user exactly once at provisioning time; if they lose it, they re-provision
-- (which rotates it). last_used_at gives the settings page a "last sync" hint.
--
-- The biometrics_daily.source enum extension to include 'apple_watch' is
-- owned by Track V (migration 011, which also adds 'whoop'). This migration
-- only adds the token table; the upsert site uses a TS cast until 011 lands.
--
-- Run this in the Supabase SQL Editor after migrations 010 (Track U) and 011
-- (Track V).

create table public.apple_watch_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create trigger trg_apple_watch_tokens_updated_at before update on public.apple_watch_tokens
  for each row execute function public.set_updated_at();

alter table public.apple_watch_tokens enable row level security;

-- No SELECT policy for authenticated clients (server-only via service role).
-- The token hash is sensitive; only the webhook needs to read it, and that
-- runs with SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.

create policy "Users can write own apple_watch_tokens" on public.apple_watch_tokens
  for insert with check (user_id = auth.uid());
create policy "Users can update own apple_watch_tokens" on public.apple_watch_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can delete own apple_watch_tokens" on public.apple_watch_tokens
  for delete using (user_id = auth.uid());
