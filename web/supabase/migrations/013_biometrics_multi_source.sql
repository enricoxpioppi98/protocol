-- Protocol v2: Composite PK + per-user metric source priority + merged view.
--
-- Problem: `biometrics_daily` PK is `(user_id, date)`. With Garmin + Whoop +
-- Apple Watch all writing rows for the same day, the second sync silently
-- overwrites the first. Three weeks of HRV from Whoop disappear the moment a
-- user clicks "Sync Garmin".
--
-- Fix:
--   1. Drop the PK and recreate it as `(user_id, date, source)` so each source
--      gets its own row per day. This is safe — every existing row already has
--      `source` populated (default 'manual'; Garmin/Whoop/Apple Watch always
--      stamp their own values), so no row collisions on the new PK.
--   2. Add `user_profile.metric_source_priority jsonb` so users can express
--      "prefer Whoop HRV over Garmin HRV" without code changes. v2 ships with
--      a single `default` priority list applied to every metric; future
--      revisions can branch by metric (e.g. `{"hrv_ms": [...]}` overrides).
--   3. Create `biometrics_daily_merged` — a view that emits one row per
--      (user_id, date) with each metric column populated from the
--      highest-priority NON-NULL source for that user. Read sites (briefing
--      assembler, dashboard, progress, history) point at the view; write
--      sites (sync routes) keep writing the underlying table.
--
-- Safety check on the PK swap:
--   - No FOREIGN KEY references `biometrics_daily` (verified via grep across
--     all migrations 004-012).
--   - The `supabase_realtime` publication includes `biometrics_daily` (added
--     in migration 004). Publication membership survives a PK swap; PostgreSQL
--     auto-updates REPLICA IDENTITY to the new PK. No publication tweak needed.
--   - The `daily_briefing` realtime publication is on a separate table; it
--     does not reference `biometrics_daily` at the schema level.
--
-- Run this in the Supabase SQL Editor after migration 012.

-- ============================================================
-- 1. Composite primary key (user_id, date, source)
-- ============================================================

alter table public.biometrics_daily drop constraint biometrics_daily_pkey;
alter table public.biometrics_daily
  add constraint biometrics_daily_pkey primary key (user_id, date, source);

-- ============================================================
-- 2. user_profile.metric_source_priority
-- ============================================================
--
-- Shape: { "default": ["whoop", "garmin", "apple_watch", "manual"] }
--
-- The view consumes the `default` array — index 0 is highest priority.
-- We pick the value from the lowest-index source whose value IS NOT NULL.
-- Sources not listed (or rows whose source is unknown) sort last (rank 999).
--
-- Default order rationale:
--   - garmin first: today's most-tested integration, broadest metric coverage
--     (training_load_acute, body_battery, vo2max all come from Garmin).
--   - whoop next: best HRV/recovery quality on overlapping metrics.
--   - apple_watch: pull-only, sparse coverage on advanced metrics.
--   - manual: lowest priority — never overrides a real device reading if both
--     are present, but fills the gap when no device synced.

alter table public.user_profile add column if not exists metric_source_priority jsonb
  not null default '{
    "default": ["garmin", "whoop", "apple_watch", "manual"]
  }'::jsonb;

-- ============================================================
-- 3. biometrics_daily_merged view
-- ============================================================
--
-- Per-column strategy: array_agg the column ordered by source_rank, filtered to
-- non-null values, then take the first element. This picks the value from the
-- highest-priority source that actually has data. If every source is null for
-- a metric, the result is null — same as today.
--
-- The view also exposes:
--   - `source`: which source's row "won" overall (the highest-priority source
--     that has any non-null metric on that day). Existing UI checks like
--     `biometrics?.source === 'manual'` keep working — the badge appears only
--     when manual is the priority winner (i.e. no device had data that day).
--   - `sources_present`: comma-separated list of every source that wrote a
--     row for that day. Lets the future sync dashboard show "garmin, whoop"
--     attribution without a second query.
--   - `fetched_at`: max across the day's rows so "last synced" stays meaningful.
--
-- The view does NOT expose `raw` (per-source debug payloads can't merge into
-- a single jsonb cleanly) or per-source attribution per-metric. Read sites
-- that need those should query the underlying `biometrics_daily` table.

create or replace view public.biometrics_daily_merged as
with ranked as (
  select
    bd.*,
    coalesce(
      array_position(
        array(
          select jsonb_array_elements_text(
            coalesce(up.metric_source_priority->'default',
                     '["garmin", "whoop", "apple_watch", "manual"]'::jsonb)
          )
        ),
        bd.source
      ),
      999
    ) as source_rank
  from public.biometrics_daily bd
  left join public.user_profile up on up.user_id = bd.user_id
)
select
  user_id,
  date,
  -- Original v1 metrics (migration 004)
  (array_agg(sleep_score             order by source_rank) filter (where sleep_score             is not null))[1] as sleep_score,
  (array_agg(sleep_duration_minutes  order by source_rank) filter (where sleep_duration_minutes  is not null))[1] as sleep_duration_minutes,
  (array_agg(hrv_ms                  order by source_rank) filter (where hrv_ms                  is not null))[1] as hrv_ms,
  (array_agg(resting_hr              order by source_rank) filter (where resting_hr              is not null))[1] as resting_hr,
  (array_agg(stress_avg              order by source_rank) filter (where stress_avg              is not null))[1] as stress_avg,
  (array_agg(training_load_acute     order by source_rank) filter (where training_load_acute     is not null))[1] as training_load_acute,
  (array_agg(training_load_chronic   order by source_rank) filter (where training_load_chronic   is not null))[1] as training_load_chronic,
  -- Movement / activity volume (migration 006)
  (array_agg(total_steps             order by source_rank) filter (where total_steps             is not null))[1] as total_steps,
  (array_agg(floors_climbed          order by source_rank) filter (where floors_climbed          is not null))[1] as floors_climbed,
  (array_agg(active_minutes          order by source_rank) filter (where active_minutes          is not null))[1] as active_minutes,
  (array_agg(vigorous_minutes        order by source_rank) filter (where vigorous_minutes        is not null))[1] as vigorous_minutes,
  (array_agg(moderate_minutes        order by source_rank) filter (where moderate_minutes        is not null))[1] as moderate_minutes,
  (array_agg(total_kcal_burned       order by source_rank) filter (where total_kcal_burned       is not null))[1] as total_kcal_burned,
  (array_agg(active_kcal_burned      order by source_rank) filter (where active_kcal_burned      is not null))[1] as active_kcal_burned,
  -- Cardiovascular (migration 006)
  (array_agg(vo2max                  order by source_rank) filter (where vo2max                  is not null))[1] as vo2max,
  (array_agg(max_hr                  order by source_rank) filter (where max_hr                  is not null))[1] as max_hr,
  (array_agg(min_hr                  order by source_rank) filter (where min_hr                  is not null))[1] as min_hr,
  -- Sleep sub-stages (migration 006)
  (array_agg(deep_sleep_minutes      order by source_rank) filter (where deep_sleep_minutes      is not null))[1] as deep_sleep_minutes,
  (array_agg(rem_sleep_minutes       order by source_rank) filter (where rem_sleep_minutes       is not null))[1] as rem_sleep_minutes,
  (array_agg(light_sleep_minutes     order by source_rank) filter (where light_sleep_minutes     is not null))[1] as light_sleep_minutes,
  (array_agg(awake_sleep_minutes     order by source_rank) filter (where awake_sleep_minutes     is not null))[1] as awake_sleep_minutes,
  (array_agg(sleep_efficiency        order by source_rank) filter (where sleep_efficiency        is not null))[1] as sleep_efficiency,
  -- Body battery (migration 006)
  (array_agg(body_battery_high       order by source_rank) filter (where body_battery_high       is not null))[1] as body_battery_high,
  (array_agg(body_battery_low        order by source_rank) filter (where body_battery_low        is not null))[1] as body_battery_low,
  (array_agg(body_battery_charged    order by source_rank) filter (where body_battery_charged    is not null))[1] as body_battery_charged,
  (array_agg(body_battery_drained    order by source_rank) filter (where body_battery_drained    is not null))[1] as body_battery_drained,
  -- Aggregates / attribution (these rows are ALWAYS non-null, so no FILTER)
  (array_agg(source                  order by source_rank))[1]                                                  as source,
  (array_agg(fetched_at              order by fetched_at desc))[1]                                              as fetched_at,
  (array_agg(updated_at              order by updated_at desc))[1]                                              as updated_at,
  string_agg(distinct source, ',' order by source)                                                              as sources_present
from ranked
group by user_id, date;

-- View runs with the querying user's privileges and the underlying table's
-- RLS already restricts to `user_id = auth.uid()`. So a user only ever sees
-- their own merged rows. We still grant SELECT to authenticated and the
-- service role for explicit readability.
grant select on public.biometrics_daily_merged to authenticated;
grant select on public.biometrics_daily_merged to service_role;

comment on view public.biometrics_daily_merged is
  'One row per (user_id, date), values picked by user_profile.metric_source_priority->''default''. Read-only; writes go to biometrics_daily.';
