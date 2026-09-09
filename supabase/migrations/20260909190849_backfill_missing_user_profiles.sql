INSERT INTO public.profiles (id, display_name)
SELECT u.id,
       COALESCE(
         NULLIF(u.raw_user_meta_data ->> 'display_name', ''),
         NULLIF(u.raw_user_meta_data ->> 'name', ''),
         split_part(COALESCE(u.email, 'user'), '@', 1)
       )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
