-- Protocol v1: pinned metrics on the dashboard BiometricsCard.
-- Adds a configurable allow-list of metric identifiers the user has pinned.
-- The card filters AVAILABLE_METRICS by this list and renders them in pin order.
--
-- The default reproduces today's hardcoded 4-stat grid so existing users see
-- no change until they explicitly customize their pins.
--
-- RLS is already enabled on user_profile in 004_protocol_v1.sql; the
-- "Users can CRUD own user_profile" policy covers reads/writes to this column.

alter table public.user_profile
  add column pinned_metrics text[] not null
    default array['sleep_score', 'hrv_ms', 'resting_hr', 'stress_avg']::text[];
