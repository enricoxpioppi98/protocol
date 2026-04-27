-- Protocol v1: extended biometrics
-- Adds the additional Garmin metrics that Bryan Johnson's Blueprint protocol
-- prioritizes (movement, body composition, recovery sub-scores) onto
-- biometrics_daily. All columns are nullable — Garmin's payload is sparse on
-- some watch models and we want to tolerate missing values per row.
-- Run this in the Supabase SQL Editor after migration 005.

-- ============================================================
-- COLUMNS
-- ============================================================

-- Movement / activity volume
alter table public.biometrics_daily add column if not exists total_steps int;
alter table public.biometrics_daily add column if not exists floors_climbed int;
alter table public.biometrics_daily add column if not exists active_minutes int;
alter table public.biometrics_daily add column if not exists vigorous_minutes int;
alter table public.biometrics_daily add column if not exists moderate_minutes int;
alter table public.biometrics_daily add column if not exists total_kcal_burned int;
alter table public.biometrics_daily add column if not exists active_kcal_burned int;

-- Cardiovascular
alter table public.biometrics_daily add column if not exists vo2max real;
alter table public.biometrics_daily add column if not exists max_hr int;
alter table public.biometrics_daily add column if not exists min_hr int;

-- Sleep sub-stages
alter table public.biometrics_daily add column if not exists deep_sleep_minutes int;
alter table public.biometrics_daily add column if not exists rem_sleep_minutes int;
alter table public.biometrics_daily add column if not exists light_sleep_minutes int;
alter table public.biometrics_daily add column if not exists awake_sleep_minutes int;
alter table public.biometrics_daily add column if not exists sleep_efficiency real;

-- Body battery (Garmin's recovery sub-score)
alter table public.biometrics_daily add column if not exists body_battery_high int;
alter table public.biometrics_daily add column if not exists body_battery_low int;
alter table public.biometrics_daily add column if not exists body_battery_charged int;
alter table public.biometrics_daily add column if not exists body_battery_drained int;

-- RLS already covers biometrics_daily via the policy in migration 004.
-- No new policies, indexes, or publication changes needed.
