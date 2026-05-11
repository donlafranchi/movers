-- T042 — System Member row (Phase 0)
-- Source: notes/migration-to-primitives.md § Phase 0 — AI-native floor
--
-- Inserts the system Member row. The system Member is used as
-- `acting_member_id` for platform-emitted events that have no human actor
-- (eventually: dormancy jobs, partition rotations, automated cleanup, etc.).
-- It also reserves the 'system' handle so no human can claim it.
--
-- The bootstrap `member.created` event self-references — `acting_member_id =
-- member_id = SYSTEM_MEMBER_ID` — which is the ONE documented exception to
-- ADR-6's "audit field must reference a different acting Member than the
-- target." All future `member.created` events have `acting_member_id = <new
-- member id>` (the new Member acts on their own creation per the rebuild
-- plan's exit criterion).
--
-- This migration uses raw INSERT for the system Member because the action
-- layer (T043) does not exist yet. This is the ONE documented exception to
-- ADR-7's "the action layer is the only write surface." DEVIATIONS.md
-- records this. After T043 lands, no further raw inserts to members or
-- member_events are permitted (CI conformance check, also added in T043).
--
-- The id constant is mirrored in web/src/lib/system-member.ts so app code
-- can reference it without hard-coding a UUID literal everywhere.

insert into public.members (id, handle, display_name, login_disabled, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'System',
  true,
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.member_events (member_id, event_kind, payload, acting_member_id, created_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'member.created',
  jsonb_build_object('source', 'bootstrap', 'handle', 'system'),
  '00000000-0000-0000-0000-000000000001',
  now()
)
on conflict do nothing;

comment on column public.members.handle is
  E'4-30 chars, lowercase alnum + hyphen, unique. The handle ''system'' is reserved by 002b_system_member.sql; the unique constraint blocks human attempts to claim it.';
