-- Protocol — demo seed data
--
-- Populates a signed-in user's account with realistic data so the v1 demo
-- loop has something to render: a filled user_profile, the past 7 days of
-- biometrics, a handful of diary entries (today + yesterday), today's
-- briefing.
--
-- USAGE
--   1. Sign up at /signup to create your auth user.
--   2. Find your user_id:
--        select id from auth.users where email = 'you@example.com';
--   3. Paste this script into the Supabase SQL Editor and replace EVERY
--      occurrence of <USER_ID> below with that uuid.
--   4. Run.
--
-- IDEMPOTENT: re-running this overwrites the seeded rows for the same user
-- via on conflict (user_id, date) where applicable.

-- ============================================================
-- USER PROFILE
-- ============================================================
update public.user_profile
set
  goals = jsonb_build_object(
    'primary',   'sub-20 5K',
    'secondary', 'build muscle without losing run pace'
  ),
  dietary_restrictions = array['shellfish allergy']::text[],
  equipment_available  = array['gym membership', 'dumbbells', 'barbell', 'pull-up bar', 'bench', 'treadmill']::text[],
  weekly_schedule      = jsonb_build_object(
    'monday',    array['lift'],
    'tuesday',   array['run'],
    'wednesday', array['lift'],
    'thursday',  array['run'],
    'friday',    array['lift'],
    'saturday',  array['run', 'long'],
    'sunday',    array['rest']
  ),
  notes = 'Building base for fall 5K. Knees fine, no injuries. Coffee in the morning.'
where user_id = '<USER_ID>';

-- ============================================================
-- BIOMETRICS — past 7 days
-- ============================================================
insert into public.biometrics_daily (
  user_id, date,
  sleep_score, sleep_duration_minutes, hrv_ms, resting_hr, stress_avg,
  training_load_acute, training_load_chronic,
  source, raw, fetched_at
) values
  ('<USER_ID>', current_date - interval '6 day', 72,  430, 44, 54, 28, 380, 410, 'manual', null, now()),
  ('<USER_ID>', current_date - interval '5 day', 81,  455, 49, 51, 22, 410, 412, 'manual', null, now()),
  ('<USER_ID>', current_date - interval '4 day', 65,  395, 38, 56, 41, 440, 415, 'manual', null, now()),
  ('<USER_ID>', current_date - interval '3 day', 58,  370, 36, 58, 48, 470, 420, 'manual', null, now()),
  ('<USER_ID>', current_date - interval '2 day', 76,  445, 47, 52, 26, 460, 425, 'manual', null, now()),
  ('<USER_ID>', current_date - interval '1 day', 79,  460, 48, 51, 24, 450, 428, 'manual', null, now()),
  ('<USER_ID>', current_date,                    83,  475, 51, 50, 21, 445, 430, 'manual', null, now())
on conflict (user_id, date) do update set
  sleep_score = excluded.sleep_score,
  sleep_duration_minutes = excluded.sleep_duration_minutes,
  hrv_ms = excluded.hrv_ms,
  resting_hr = excluded.resting_hr,
  stress_avg = excluded.stress_avg,
  training_load_acute = excluded.training_load_acute,
  training_load_chronic = excluded.training_load_chronic,
  fetched_at = excluded.fetched_at;

-- ============================================================
-- FOODS — a tiny pantry of basics so diary entries can resolve
-- ============================================================
insert into public.foods (id, user_id, name, brand, calories, protein, carbs, fat, fiber, serving_size, serving_unit, is_custom, is_favorite)
values
  (gen_random_uuid(), '<USER_ID>', '0% Greek yogurt', '', 59, 10, 3.6, 0.4, 0,   100, 'g', true, true),
  (gen_random_uuid(), '<USER_ID>', 'Rolled oats',     '', 379, 13, 67,  7,   10,  100, 'g', true, false),
  (gen_random_uuid(), '<USER_ID>', 'Banana',          '', 89,  1.1, 23, 0.3, 2.6, 100, 'g', true, false),
  (gen_random_uuid(), '<USER_ID>', 'Chicken breast',  '', 165, 31,  0,   3.6, 0,   100, 'g', true, true),
  (gen_random_uuid(), '<USER_ID>', 'White rice (cooked)', '', 130, 2.7, 28, 0.3, 0.4, 100, 'g', true, false)
on conflict do nothing;

-- ============================================================
-- DIARY — today and yesterday, partial logging
-- ============================================================
do $$
declare
  uid uuid := '<USER_ID>';
  fid_yogurt uuid;
  fid_oats   uuid;
  fid_banana uuid;
  fid_chicken uuid;
  fid_rice   uuid;
begin
  select id into fid_yogurt  from public.foods where user_id = uid and name = '0% Greek yogurt' limit 1;
  select id into fid_oats    from public.foods where user_id = uid and name = 'Rolled oats' limit 1;
  select id into fid_banana  from public.foods where user_id = uid and name = 'Banana' limit 1;
  select id into fid_chicken from public.foods where user_id = uid and name = 'Chicken breast' limit 1;
  select id into fid_rice    from public.foods where user_id = uid and name = 'White rice (cooked)' limit 1;

  -- Today: Breakfast already logged
  insert into public.diary_entries (user_id, date, meal_type, number_of_servings, food_id)
    values (uid, current_date, 'Breakfast', 2.5, fid_yogurt),
           (uid, current_date, 'Breakfast', 0.6, fid_oats),
           (uid, current_date, 'Breakfast', 1.0, fid_banana);

  -- Yesterday: full day
  insert into public.diary_entries (user_id, date, meal_type, number_of_servings, food_id)
    values (uid, current_date - 1, 'Breakfast', 2.0, fid_yogurt),
           (uid, current_date - 1, 'Lunch',     2.0, fid_chicken),
           (uid, current_date - 1, 'Lunch',     2.5, fid_rice),
           (uid, current_date - 1, 'Dinner',    2.0, fid_chicken),
           (uid, current_date - 1, 'Dinner',    2.0, fid_rice);
end $$;

-- ============================================================
-- DAILY BRIEFING — yesterday's plan (so today's continuity check has something to read)
-- ============================================================
insert into public.daily_briefing (user_id, date, meals, workout, recovery_note, model, prompt_cache_hit, generated_at)
values (
  '<USER_ID>',
  current_date - 1,
  '[
    {"slot":"breakfast","name":"Greek yogurt + oats + banana","items":[{"food":"0% Greek yogurt","grams":250},{"food":"rolled oats","grams":60},{"food":"banana","grams":120}],"macros":{"kcal":480,"p":35,"c":80,"f":7}},
    {"slot":"lunch","name":"Chicken rice bowl","items":[{"food":"chicken breast","grams":200},{"food":"white rice (cooked)","grams":250}],"macros":{"kcal":655,"p":62,"c":70,"f":10}},
    {"slot":"dinner","name":"Chicken + rice (round 2)","items":[{"food":"chicken breast","grams":200},{"food":"white rice (cooked)","grams":200}],"macros":{"kcal":590,"p":62,"c":56,"f":8}}
  ]'::jsonb,
  '{
    "name":"Easy 4mi run",
    "duration_minutes":40,
    "blocks":[
      {"name":"Warm-up jog","reps":"10 min","intensity":"Z1"},
      {"name":"Easy continuous","reps":"25 min","intensity":"Z2 (HR < 145)"},
      {"name":"Cool-down","reps":"5 min","intensity":"Z1"}
    ]
  }'::jsonb,
  'Solid recovery yesterday — easy aerobic today to top up base mileage.',
  'claude-sonnet-4-6',
  true,
  now() - interval '1 day'
)
on conflict (user_id, date) do update set
  meals = excluded.meals,
  workout = excluded.workout,
  recovery_note = excluded.recovery_note,
  generated_at = excluded.generated_at;
