-- T041 — Member embeddings (reserved substrate)
-- Phase 0 — AI-native floor
-- Source: notes/migration-to-primitives.md § Phase 0; product/systems/member.md T3
--
-- Empty parallel table. Reserves storage for per-Member vector embeddings
-- written by the T3 embedding pipeline (Member bio + interests → embedding).
-- No rows are inserted at b1.
--
-- FK note: `member_id` does NOT reference `public.members` at this point —
-- the `members` table lands in Phase 0 T042 (immediately after this ticket).
-- T042's migration may add the FK at that point, OR the FK is added by the
-- Phase 1 ticket that augments the members schema. Recorded here for
-- traceability:
--
--   alter table public.member_embeddings
--     add constraint member_embeddings_member_id_fkey
--     foreign key (member_id) references public.members(id) on delete cascade;
--
-- Per ADR-10: this table does NOT write event-log rows. It is substrate.

create table public.member_embeddings (
  member_id      uuid          not null,
  model_version  text          not null,
  embedding      vector(1536)  not null,
  created_at     timestamptz   not null default now(),
  primary key (member_id, model_version)
);

comment on table public.member_embeddings is
  'Per-Member vector embeddings. Reserved substrate at b1; populated by T3 embedding pipeline. FK to members(id) is added by T042 or the Phase 1 members-augmentation ticket.';
