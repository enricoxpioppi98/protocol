-- Track 24 (v3): nightly causal correlation discovery.
--
-- Stores the per-user "personal patterns" the coach surfaces in briefings and
-- progress views. One row per (user_id, pattern_kind) — UPSERT on every nightly
-- recompute via /api/coach/patterns/recompute. Patterns whose r/p no longer
-- clear the significance gate are DELETEd at the start of each run, so the
-- table only ever holds findings that survived the most recent computation.
--
-- Contract: writes via the service-role client (cron). RLS exposes SELECT to
-- the owning user; no INSERT/UPDATE/DELETE policies — anonymous + authenticated
-- writes are blocked. Mirrors the coach_memory + audit_ledger pattern from
-- migrations 014 + 015.

create table public.coach_patterns (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  pattern_kind  text not null,                          -- e.g. 'hrv_vs_dinner_time'
  finding_text  text not null,                          -- the human-readable line
  metric_a      text not null,
  metric_b      text not null,
  correlation   numeric not null,                       -- Spearman or Pearson r in [-1, 1]
  p_value       numeric,                                -- two-tailed; null if not computed
  sample_size   int not null,
  payload       jsonb not null default '{}'::jsonb,     -- raw stats: mean_a, mean_b, group breakdowns, etc.
  computed_at   timestamptz not null default now(),
  unique (user_id, pattern_kind)                        -- one current finding per pattern_kind, replaces on recompute
);

-- Top-N-by-strength queries (dashboard, briefing) read by abs(correlation) desc.
create index coach_patterns_user_corr_idx
  on public.coach_patterns (user_id, abs(correlation) desc);

alter table public.coach_patterns enable row level security;

create policy "Users can read own coach_patterns"
  on public.coach_patterns
  for select
  using (auth.uid() = user_id);
-- writes via service-role only (bypasses RLS).

comment on table public.coach_patterns is
  'Per-user personal patterns surfaced by the nightly correlation discovery cron (Track 24).';
