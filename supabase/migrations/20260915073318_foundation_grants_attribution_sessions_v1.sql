grant select on table public.attribution_sessions to authenticated;

comment on table public.attribution_sessions is 'Authenticated users may read only their own attribution sessions through RLS; no anon table privilege is granted.';