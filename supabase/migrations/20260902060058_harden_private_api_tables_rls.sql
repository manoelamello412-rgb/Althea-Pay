alter table private.api_request_logs enable row level security;
alter table private.api_rate_limit_buckets enable row level security;
revoke all on table private.api_request_logs from public, anon, authenticated;
revoke all on table private.api_rate_limit_buckets from public, anon, authenticated;
