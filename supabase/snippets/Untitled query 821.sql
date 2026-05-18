select count(*) from public.member_self_records;        -- expect 0
select count(*) from public.member_delegations;         -- expect 0
select indexdef from pg_indexes where indexname = 'idx_delegations_member_active';
-- expect WHERE clause: (revoked_at IS NULL) only — no now()

select conname, conrelid::regclass
from pg_constraint
where conrelid::regclass::text like '%member_events%'
  and contype = 'f' and conname like '%via_delegation%';
-- expect member_events_via_delegation_fkey + one inherited row per partition


select conname, conrelid::regclass
from pg_constraint
where conrelid::regclass::text like '%location_events%'
  and contype = 'f' and conname like '%via_delegation%';
-- expect location_events_via_delegation_fkey + one inherited row per partition