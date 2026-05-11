-- T041 — Item embeddings (reserved substrate)
-- Phase 0 — AI-native floor
-- Source: notes/migration-to-primitives.md § Phase 0; product/systems/item.md AI/LLM section
--
-- Empty parallel table. Reserves storage for per-Item vector embeddings
-- written by the T3 embedding pipeline. No rows are inserted at b1.
--
-- FK note: `item_id` does NOT reference `public.items` at this point —
-- the `items` table lands in Phase 1. The FK constraint is added by
-- the Phase 1 ticket that creates `items`. Recorded here for traceability:
--
--   alter table public.item_embeddings
--     add constraint item_embeddings_item_id_fkey
--     foreign key (item_id) references public.items(id) on delete cascade;
--
-- Per ADR-10: this table does NOT write event-log rows. It is substrate.

create table public.item_embeddings (
  item_id        uuid          not null,
  model_version  text          not null,
  embedding      vector(1536)  not null,
  created_at     timestamptz   not null default now(),
  primary key (item_id, model_version)
);

comment on table public.item_embeddings is
  'Per-Item vector embeddings. Reserved substrate at b1; populated by T3 embedding pipeline. FK to items(id) is added by the Phase 1 items-spine ticket.';
