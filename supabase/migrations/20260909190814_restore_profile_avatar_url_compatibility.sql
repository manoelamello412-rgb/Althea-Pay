ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
CREATE INDEX IF NOT EXISTS profiles_updated_at_idx ON public.profiles(updated_at DESC);
