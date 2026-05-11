-- T041 — Postgres extensions (pgvector + postgis)
-- Phase 0 — AI-native floor
-- Source: notes/migration-to-primitives.md § Phase 0
--
-- pgvector enables vector(1536) columns on the embedding tables (004, 005)
-- and on future items.embedding_id / members.embedding_id (Phase 1).
--
-- postgis enables geography(Point, 4326) on locations (Phase 1) and the
-- ST_DWithin / ST_Distance proximity queries that power /explore and
-- the locality-first index.
--
-- Both extensions must be present before any Phase 1 schema lands.

create extension if not exists vector;
create extension if not exists postgis;
