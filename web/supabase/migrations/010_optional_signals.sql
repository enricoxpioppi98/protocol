-- Protocol v1: Optional health signals (Track ?-Signals).
--
-- Adds three optional, opt-in data sources the AI coach reads ONLY when
-- present. Each is gated by the user's choice to enable it from the
-- /settings/integrations page; the coach never prompts for them.
--
--   1. glucose_readings        — sub-daily timeseries (manual or future CGM API).
--   2. blood_panels + readings — quarterly bloodwork snapshots, 1 panel = N markers.
--   3. cycle_entries           — period-start dates; current phase computed on read.
--
-- Conventions mirror migrations 004 / 008:
--   - RLS on every table; users can only see/write their own rows.
--   - set_updated_at() trigger from migration 001.
--   - Realtime publication entries for the parent tables (so the UI hot-reloads).
--   - Indexes on (user_id, <time>) so the coach context query is cheap.

-- ============================================================
-- Glucose readings (sub-daily timeseries)
-- ============================================================
create table public.glucose_readings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_at timestamptz not null,
  mg_dl int not null check (mg_dl > 0 and mg_dl < 1000),
  context text check (context in ('fasting', 'pre_meal', 'post_meal', 'overnight', 'workout', 'random')),
  -- 'manual' today; 'levels' / 'lingo' / 'stelo' wired in once a CGM API is added.
  source text not null default 'manual',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_glucose_user_time on public.glucose_readings(user_id, recorded_at desc);

create trigger trg_glucose_updated_at before update on public.glucose_readings
  for each row execute function public.set_updated_at();

alter table public.glucose_readings enable row level security;
create policy "Users can CRUD own glucose_readings" on public.glucose_readings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- Blood markers (quarterly panel snapshots)
-- ============================================================

-- One row per panel per user (a single trip to the lab).
create table public.blood_panels (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  panel_date date not null,
  lab text not null default '',           -- e.g. "Quest Diagnostics", "LabCorp"
  notes text not null default '',
  source text not null default 'manual',  -- 'manual' | 'pdf_upload'
  raw_pdf_url text,                       -- optional, if we ever store the source PDF
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Individual marker readings, normalized so we can graph one specific marker
-- (e.g. apoB) over time in a single index lookup.
create table public.blood_marker_readings (
  id uuid primary key default uuid_generate_v4(),
  panel_id uuid not null references public.blood_panels(id) on delete cascade,
  marker text not null,                   -- e.g. 'ldl', 'hdl', 'apoB', 'hsCRP', 'hbA1c'
  value real not null,
  unit text not null,                     -- 'mg/dL', 'ng/mL', 'ng/dL', 'mIU/L', '%', etc.
  reference_low real,
  reference_high real,
  -- Denormalized server-computed flag so the dashboard / coach can read it
  -- without re-doing the range comparison.
  flag text check (flag in ('low', 'normal', 'high'))
);

create index idx_blood_panels_user_date on public.blood_panels(user_id, panel_date desc);
create index idx_blood_marker_readings_panel on public.blood_marker_readings(panel_id);
create index idx_blood_marker_readings_marker on public.blood_marker_readings(marker);

create trigger trg_blood_panels_updated_at before update on public.blood_panels
  for each row execute function public.set_updated_at();

alter table public.blood_panels enable row level security;
alter table public.blood_marker_readings enable row level security;

create policy "Users can CRUD own blood_panels" on public.blood_panels
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- blood_marker_readings has no user_id column of its own — we gate via the
-- parent panel's user_id in both USING and WITH CHECK so RLS protects writes
-- as well as reads.
create policy "Users can CRUD own blood_marker_readings" on public.blood_marker_readings
  for all using (
    exists (
      select 1
      from public.blood_panels p
      where p.id = blood_marker_readings.panel_id
        and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.blood_panels p
      where p.id = blood_marker_readings.panel_id
        and p.user_id = auth.uid()
    )
  );

-- ============================================================
-- Menstrual cycle (period start dates → phase computed on read)
-- ============================================================
create table public.cycle_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  duration_days int default 5 check (duration_days between 1 and 14),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, start_date)
);

create index idx_cycle_entries_user_date on public.cycle_entries(user_id, start_date desc);

create trigger trg_cycle_entries_updated_at before update on public.cycle_entries
  for each row execute function public.set_updated_at();

alter table public.cycle_entries enable row level security;
create policy "Users can CRUD own cycle_entries" on public.cycle_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table public.glucose_readings;
alter publication supabase_realtime add table public.blood_panels;
alter publication supabase_realtime add table public.cycle_entries;
