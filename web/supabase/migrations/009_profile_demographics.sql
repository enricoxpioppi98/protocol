-- Protocol v2 (coach v2): demographic context for the AI coach.
-- Adds the user's age (via dob), gender, height, current weight baseline, and
-- training experience to user_profile so the briefing prompt can adjust
-- recommendations by age, sex, and training age.
--
-- All columns are nullable: a user who hasn't completed onboarding-v2 yet
-- still gets a briefing — the prompt has a graceful-fallback path for missing
-- demographic fields. weight_kg here is the user's "current" baseline at
-- onboarding time; the canonical tracked weight is in weight_entries.
--
-- RLS is already enabled on user_profile in 004_protocol_v1.sql; the
-- "Users can CRUD own user_profile" policy covers reads/writes to these columns.
-- Run this in the Supabase SQL Editor after migration 008 (Track K's genome work).

alter table public.user_profile
  add column if not exists dob date;

alter table public.user_profile
  add column if not exists gender text
    check (gender in ('male', 'female', 'nonbinary', 'prefer_not_to_say'));

alter table public.user_profile
  add column if not exists height_cm real;

alter table public.user_profile
  add column if not exists weight_kg real;

alter table public.user_profile
  add column if not exists training_experience text
    check (training_experience in ('beginner', 'intermediate', 'advanced'));
