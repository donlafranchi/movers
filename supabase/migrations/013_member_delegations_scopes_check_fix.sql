-- T054 — Fix empty-scopes CHECK on public.member_delegations.
--
-- Bug: 012_member_agent_assistance.sql line 100-101 declared the column-level
-- CHECK inline as `check (array_length(scopes, 1) >= 1)`. Postgres returns
-- NULL (not 0) for `array_length(arr, 1)` when `arr` is empty; a CHECK
-- predicate that evaluates to NULL is treated as passing. Result:
-- `insert ... values (..., scopes => '{}')` succeeds despite the intent.
--
-- Fix: `cardinality(scopes) >= 1` returns 0 for empty arrays (never NULL),
-- so the predicate evaluates to FALSE and the CHECK rejects the insert
-- with SQLSTATE 23514. Postgres-recommended idiom for non-empty-array
-- checks (PG 9.4+, docs § 9.18 Array Functions and Operators).
--
-- The original inline CHECK was auto-named by Postgres as
-- `member_delegations_scopes_check` (pattern <table>_<column>_check).
-- This migration drops that constraint and re-adds it under an explicit
-- name so future maintainers don't repeat the discovery.
--
-- Forward-only migration per CLAUDE.md § rebuild rules: 012 is not edited.
--
-- Anchors: T050 (original migration), ADR-7 (action layer — Delegation rows
-- carry ≥1 scope for scoped-capability vending), member.md § agent-assistance.

alter table public.member_delegations
  drop constraint member_delegations_scopes_check;

alter table public.member_delegations
  add constraint member_delegations_scopes_non_empty_check
  check (cardinality(scopes) >= 1);
