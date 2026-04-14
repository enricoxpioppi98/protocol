-- MacroTracker Supabase Schema
-- Run this in the Supabase SQL Editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- FOODS
create table public.foods (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text not null default '',
  barcode text not null default '',
  calories double precision not null default 0,
  protein double precision not null default 0,
  carbs double precision not null default 0,
  fat double precision not null default 0,
  serving_size double precision not null default 100,
  serving_unit text not null default 'g',
  is_custom boolean not null default true,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- RECIPES
create table public.recipes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  servings double precision not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- RECIPE_INGREDIENTS
create table public.recipe_ingredients (
  id uuid primary key default uuid_generate_v4(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  food_id uuid not null references public.foods(id) on delete cascade,
  quantity double precision not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- DIARY_ENTRIES
create table public.diary_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meal_type text not null check (meal_type in ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
  number_of_servings double precision not null default 1,
  food_id uuid references public.foods(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint entry_has_source check (food_id is not null or recipe_id is not null)
);

-- DAILY_GOALS
create table public.daily_goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calories double precision not null default 2000,
  protein double precision not null default 150,
  carbs double precision not null default 250,
  fat double precision not null default 65,
  day_of_week int not null default 0 check (day_of_week >= 0 and day_of_week <= 7),
  updated_at timestamptz not null default now(),
  unique(user_id, day_of_week)
);

-- WEIGHT_ENTRIES
create table public.weight_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight double precision not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- MEAL_TEMPLATES
create table public.meal_templates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  meal_type text not null check (meal_type in ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- MEAL_TEMPLATE_ITEMS
create table public.meal_template_items (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.meal_templates(id) on delete cascade,
  food_id uuid not null references public.foods(id) on delete cascade,
  number_of_servings double precision not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- USER_SETTINGS (per-user API keys and preferences)
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nutritionix_app_id text default '',
  nutritionix_app_key text default '',
  usda_api_key text default '',
  updated_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_diary_entries_user_date on public.diary_entries(user_id, date) where deleted_at is null;
create index idx_foods_user_id on public.foods(user_id) where deleted_at is null;
create index idx_weight_entries_user_date on public.weight_entries(user_id, date) where deleted_at is null;
create index idx_recipes_user_id on public.recipes(user_id) where deleted_at is null;

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'foods', 'recipes', 'recipe_ingredients', 'diary_entries',
      'daily_goals', 'weight_entries', 'meal_templates',
      'meal_template_items', 'user_settings'
    ])
  loop
    execute format(
      'create trigger trg_%s_updated_at before update on public.%s
       for each row execute function public.set_updated_at()',
      tbl, tbl
    );
  end loop;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.foods enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.diary_entries enable row level security;
alter table public.daily_goals enable row level security;
alter table public.weight_entries enable row level security;
alter table public.meal_templates enable row level security;
alter table public.meal_template_items enable row level security;
alter table public.user_settings enable row level security;

-- User-owns-row policies
create policy "Users can CRUD own foods" on public.foods
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own recipes" on public.recipes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own diary_entries" on public.diary_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own daily_goals" on public.daily_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own weight_entries" on public.weight_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own meal_templates" on public.meal_templates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users can CRUD own user_settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child tables: check parent ownership
create policy "Users can CRUD own recipe_ingredients" on public.recipe_ingredients
  for all using (
    exists (select 1 from public.recipes where id = recipe_id and user_id = auth.uid())
  ) with check (
    exists (select 1 from public.recipes where id = recipe_id and user_id = auth.uid())
  );

create policy "Users can CRUD own meal_template_items" on public.meal_template_items
  for all using (
    exists (select 1 from public.meal_templates where id = template_id and user_id = auth.uid())
  ) with check (
    exists (select 1 from public.meal_templates where id = template_id and user_id = auth.uid())
  );

-- ============================================================
-- NEW USER TRIGGER (auto-create settings + default goal)
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  insert into public.daily_goals (user_id, calories, protein, carbs, fat, day_of_week)
    values (new.id, 2000, 150, 250, 65, 0);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
