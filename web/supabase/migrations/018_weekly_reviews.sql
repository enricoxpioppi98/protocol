-- Track 25: weekly review.
-- One row per (user, week_start). week_start is Monday of the week being
-- reviewed. The Sunday-evening cron (and the on-demand POST) writes the
-- structured review payload + an optional pre-rendered markdown blob the
-- /weekly page renders without re-running JSON.parse on each load.

create table public.weekly_reviews (
  user_id      uuid not null references auth.users(id) on delete cascade,
  week_start   date not null,             -- Monday of the week being reviewed
  summary      jsonb not null,            -- the structured payload
  rendered_md  text,                       -- optional: pre-rendered markdown for the UI
  model        text,
  generated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create index weekly_reviews_user_week_idx
  on public.weekly_reviews (user_id, week_start desc);

alter table public.weekly_reviews enable row level security;
create policy "Users can read own weekly_reviews"
  on public.weekly_reviews
  for select
  using (auth.uid() = user_id);
-- service role writes only.

alter publication supabase_realtime add table public.weekly_reviews;
