-- Add fiber tracking to foods and daily goals
ALTER TABLE public.foods ADD COLUMN fiber double precision NOT NULL DEFAULT 0;
ALTER TABLE public.daily_goals ADD COLUMN fiber double precision NOT NULL DEFAULT 25;

-- Update the new-user trigger to include fiber in default goal
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_settings (user_id) VALUES (new.id);
  INSERT INTO public.daily_goals (user_id, calories, protein, carbs, fat, fiber, day_of_week)
    VALUES (new.id, 2000, 150, 250, 65, 25, 0);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
