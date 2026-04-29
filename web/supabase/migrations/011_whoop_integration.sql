-- Protocol v1: Whoop OAuth integration
-- Adds the encrypted-token table for Whoop's authorization-code OAuth flow
-- and extends biometrics_daily.source to include 'whoop' (this track) and
-- 'apple_watch' (Track W). Whoop data lands in the same biometrics_daily
-- columns Garmin uses, with source='whoop' on overlapping days resolved by
-- most-recent fetched_at.
-- Run this in the Supabase SQL Editor after migrations 001-010.

-- ============================================================
-- WHOOP_CREDENTIALS — one row per user.
-- access_token is short-lived (~1h); we cache it and refresh on demand.
-- refresh_token is the long-lived secret that lets us mint new access tokens.
-- Both are AES-256-GCM ciphertext (base64) using GARMIN_ENC_KEY env. The key
-- is shared with garmin_credentials for v1 — there is only one AES key in the
-- app today; rename to a more generic name in a follow-up if/when other
-- integrations are added.
-- The client must NEVER select from this table; routes that touch it run
-- server-side only via the service-role client.
-- ============================================================

create table public.whoop_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whoop_user_id text,
  refresh_token_encrypted text not null,
  access_token_encrypted text,
  access_token_expires_at timestamptz,
  scopes text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_whoop_creds_updated_at before update on public.whoop_credentials
  for each row execute function public.set_updated_at();

alter table public.whoop_credentials enable row level security;

-- Server-side only: deliberately omit a SELECT policy so authenticated clients
-- cannot read encrypted tokens. Server routes use SUPABASE_SERVICE_ROLE_KEY
-- which bypasses RLS. We do allow the user to write/update/delete their own
-- row via the service-role-backed routes so the policies are still scoped.
create policy "Users can write own whoop_credentials" on public.whoop_credentials
  for insert with check (user_id = auth.uid());
create policy "Users can update own whoop_credentials" on public.whoop_credentials
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can delete own whoop_credentials" on public.whoop_credentials
  for delete using (user_id = auth.uid());

-- ============================================================
-- Extend biometrics_daily.source to include 'whoop' and 'apple_watch'.
-- Track W (apple_watch) is added here too, by agreement, so Track W's
-- migration 012 can write rows without a second constraint flip.
-- ============================================================

alter table public.biometrics_daily drop constraint biometrics_daily_source_check;
alter table public.biometrics_daily add constraint biometrics_daily_source_check
  check (source in ('garmin', 'manual', 'whoop', 'apple_watch'));
