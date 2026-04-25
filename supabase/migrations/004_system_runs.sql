-- 004_system_runs.sql
-- T024: tiny tracker for periodic jobs run lazily on first request per day,
-- until a real scheduler is wired up.

create table if not exists system_runs (
  job_name text primary key,
  last_run_at timestamptz not null default now()
);

alter table system_runs enable row level security;
-- Server-side service role only; no public policies.
