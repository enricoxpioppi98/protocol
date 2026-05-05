-- Wave 4: morning coach checkin.
-- One row per (user, day). Server generates the question with Claude using
-- assembleCoachContext, the user submits an answer (free-text or one of the
-- quick_replies), the dashboard then triggers a briefing regen so the answer
-- shapes today's plan.

create table public.morning_checkins (
  user_id                   uuid not null references auth.users(id) on delete cascade,
  date                      date not null,
  question_text             text not null,
  quick_replies             jsonb not null default '[]'::jsonb,  -- string[]
  rationale                 text,                                 -- internal-only
  answer_text               text,
  answer_quick_reply_index  int,
  answered_at               timestamptz,
  generated_at              timestamptz not null default now(),
  primary key (user_id, date)
);

create index morning_checkins_user_date_idx
  on public.morning_checkins (user_id, date desc);

alter table public.morning_checkins enable row level security;

-- Read + update own; INSERT goes through service-role (server-side generation)
-- so we don't need a user-side INSERT policy.
create policy "Users can read own morning_checkins"
  on public.morning_checkins
  for select
  using (auth.uid() = user_id);

create policy "Users can update own morning_checkins"
  on public.morning_checkins
  for update
  using (auth.uid() = user_id);

-- Realtime so the card animates in if generated server-side after page load.
alter publication supabase_realtime add table public.morning_checkins;
