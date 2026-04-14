-- Enable Supabase Realtime on key tables
-- Run this in the Supabase SQL Editor

alter publication supabase_realtime add table public.diary_entries;
alter publication supabase_realtime add table public.foods;
alter publication supabase_realtime add table public.daily_goals;
alter publication supabase_realtime add table public.recipes;
alter publication supabase_realtime add table public.recipe_ingredients;
alter publication supabase_realtime add table public.weight_entries;
