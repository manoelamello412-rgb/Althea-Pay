
grant select on public.organization_members to service_role;
grant select on public.funnel_gateway_bindings to service_role;

grant select, insert, update on public.funnel_connections to service_role;
grant select, insert, update on public.funnel_connection_gateway_mappings to service_role;
grant select on public.funnel_command_batches to service_role;
grant select on public.funnel_command_targets to service_role;
grant select, insert, update on public.funnel_control_drift_events to service_role;
