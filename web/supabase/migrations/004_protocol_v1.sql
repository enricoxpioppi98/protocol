-- Protocol v1: AI coaching layer
-- Adds the AI-side schema on top of MacroTracker's nutrition foundation.
-- Run this in the Supabase SQL Editor after migrations 001-003.

-- ============================================================
-- TABLES
-- ============================================================

-- USER_PROFILE — coaching context for the AI: goals, restrictions, equipment, schedule.
-- One row per user. JSON columns are intentionally freeform so Claude can read them
-- directly without a brittle schema layer.
create table public.user_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goals jsonb not null default '{}'::jsonb,
  dietary_restrictions text[] not null default array[]::text[],
  equipment_available text[] not null default array[]::text[],
  weekly_schedule jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BIOMETRICS_DAILY — one row per user per day. Source = 'garmin' or 'manual'.
-- raw holds the full Garmin payload for debugging / future fields.
create table public.biometrics_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sleep_score int,
  sleep_duration_minutes int,
  hrv_ms int,
  resting_hr int,
  stress_avg int,
  training_load_acute int,
  training_load_chronic int,
  source text not null default 'manual' check (source in ('garmin', 'manual')),
  raw jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- DAILY_BRIEFING — Claude's output for the day. Generated once per day; can be regenerated.
-- meals/workout JSON shapes are validated server-side via Zod before insert.
create table public.daily_briefing (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meals jsonb not null default '[]'::jsonb,
  workout jsonb not null default '{}'::jsonb,
  recovery_note text not null default '',
  model text not null default '',
  prompt_cache_hit boolean not null default false,
  generated_at timestamptz not null default now(),
  regenerated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- GARMIN_CREDENTIALS — encrypted Garmin Connect login. Server-only access.
-- password_encrypted is AES-256-GCM ciphertext (base64) using GARMIN_ENC_KEY env.
-- The client must NEVER select from this table; routes that touch it run server-side only.
create table public.garmin_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  password_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_biometrics_daily_user_date on public.biometrics_daily(user_id, date desc);
create index idx_daily_briefing_user_date on public.daily_briefing(user_id, date desc);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGERS
-- (set_updated_at() is defined in 001_initial_schema.sql)
-- ============================================================

create trigger trg_user_profile_updated_at before update on public.user_profile
  for each row execute function public.set_updated_at();

create trigger trg_biometrics_daily_updated_at before update on public.biometrics_daily
  for each row execute function public.set_updated_at();

create trigger trg_daily_briefing_updated_at before update on public.daily_briefing
  for each row execute function public.set_updated_at();

create trigger trg_garmin_credentials_updated_at before update on public.garmin_credentials
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.user_profile enable row level security;
alter table public.biometrics_daily enable row level security;
alter table public.daily_briefing enable row level security;
alter table public.garmin_credentials enable row level security;

create policy "Users can CRUD own user_profile" on public.user_profile
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own biometrics_daily" on public.biometrics_daily
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own daily_briefing" on public.daily_briefing
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- garmin_credentials: server-side only. We deliberately omit a SELECT policy
-- so that anon/authenticated clients can't read the encrypted password.
-- Server routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- We do allow the user to write/update/delete their own row through the UI.
create policy "Users can write own garmin_credentials" on public.garmin_credentials
  for insert with check (user_id = auth.uid());
create policy "Users can update own garmin_credentials" on public.garmin_credentials
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can delete own garmin_credentials" on public.garmin_credentials
  for delete using (user_id = auth.uid());

-- ============================================================
-- REALTIME
-- ============================================================

alter publication supabase_realtime add table public.biometrics_daily;
alter publication supabase_realtime add table public.daily_briefing;

-- ============================================================
-- NEW USER TRIGGER — extend handle_new_user to seed user_profile
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  insert into public.daily_goals (user_id, calories, protein, carbs, fat, fiber, day_of_week)
    values (new.id, 2000, 150, 250, 65, 25, 0);
  insert into public.user_profile (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;
