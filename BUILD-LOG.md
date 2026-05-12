# BUILD-LOG — mainstreetmarket/web

Last updated: 2026-05-11 (T048)

Development agent's build progress tracker. Use JOURNAL.md for product/strategy notes.

## Current Release

**Target:** b1 MVP — Producer Marketplace
**Start Date:** 2026-04-09
**Bundle definition:** [planning/bundles/b1-mvp.md](../planning/bundles/b1-mvp.md)

## Progress

| Ticket | Title | Status |
|--------|-------|--------|
| T001 | Project Initialization | ✅ Complete |
| T002 | Database Schema + Supabase Setup | ✅ Complete |
| T003 | Authentication | ✅ Complete |
| T004 | Map View with Colored Pins | ✅ Complete |
| T005 | Pin Clustering | ✅ Complete |
| T006 | Map Search | ✅ Complete |
| T007 | Business Detail Card | ✅ Complete |
| T008 | Business Registration | ✅ Complete |
| T009 | Shareable Listing | ✅ Complete |
| T010 | Support Button | ✅ Complete |
| T011 | Report a Concern | ✅ Complete |
| T012 | Market Schema + Seed Data | ✅ Complete |
| T013 | Bottom Navigation Shell | ✅ Complete |
| T014 | Home Feed (Etsy-style — superseded by T024) | ✅ Complete |
| T015 | Explore — Search + List/Map | ✅ Complete |
| T016 | Market Selection Modal | ✅ Complete |
| T017 | Vendor Profile Update | ✅ Complete |
| T018 | Follow Vendor + Notifications | ✅ Complete |
| T019 | Geocoding + Pin Confirmation | ⬜ Open (b1) |
| T020 | Community Pin Flagging | ⏸️ Deferred (b2) |
| T021 | Tide Accent + CTA Patterns | ✅ Complete |
| T022 | Foundational Schema (events, bulletins, vendor analytics, follow soft-delete) | ✅ Complete |
| T023 | `/you` Restructure (Saved/Following/Settings, vendor mode entry) | ✅ Complete |
| T024 | Events-driven Home Feed | ✅ Complete |
| T025 | Vendor Bulletin Compose + Delivery (T1) | ✅ Complete |
| T026 | Vendor Founder Dashboard (T1) | ✅ Complete |
| T027 | Event Surfacing on Profiles | ⏸️ Deferred (b2) |
| T028–T040 | STALE — pre-rebuild migration tickets | ⛔ STALE-banned 2026-05-09 |
| T041 | Phase 0 — Postgres extensions + embedding tables | ✅ Build complete; runtime eval pending |
| T042 | Phase 0 — Members + member_events floor + system Member | ✅ Build complete; runtime eval pending |
| T043 | Phase 0 — Action layer scaffold + `member.create` handler | ✅ Build complete; runtime eval pending |
| T044 | Phase 0 — Supabase Auth signup hook → `member.create` | ✅ Build complete; runtime eval pending |
| T045 | Phase 1 — Locations spine + 3 children + events (`007_locations.sql`) | ✅ Build complete; runtime eval pending |
| T046 | Phase 1 — Locations RLS fix-forward (`008_locations_owner_read.sql`) | ✅ Build complete; runtime eval pending |
| T047 | Phase 1 — Members augmentation: FK + privacy + handle history (`009_members_phase1.sql`) | ✅ Build complete + M2 PROCEED; runtime eval pending |
| T048 | Phase 1 — Member interests + follows (`010_member_interests_follows.sql`) | ✅ Build complete; runtime eval pending |

## Rebuild on Primitives — Phase 0 (AI-native floor)

The b1 marketplace shipped T001–T026; T027 deferred. The 2026-05-10 PM decision to rebuild on Person / Item / Location / Group primitives supersedes the prior 7-phase migration plan with a 4-phase clean-slate rebuild. T028–T040 were drafted against the prior plan and are STALE-banned. T041–T044 are the Phase 0 ticket set per [`/notes/migration-to-primitives.md`](../notes/migration-to-primitives.md).

**Phase 0 — AI-native floor (4 tickets):**

- **T041 — Postgres extensions + embedding tables.** Build complete 2026-05-10. Wiped six legacy migrations (001–006), wrote three Phase 0 migrations (001_extensions, 004_item_embeddings, 005_member_embeddings). 15 file-shape assertions passing. Runtime verified locally: extensions + tables present in Supabase. Eval-run pending T043+ test helpers.
- **T042 — Members + member_events floor + system Member.** Build complete 2026-05-10. Single consolidated migration `002_members.sql` (originally split into 002 + 002a + 002b; consolidated when Supabase CLI was found to silently skip alpha-suffixed filenames — see DEVIATIONS). Three logical sections: members table + RLS + indexes + updated_at trigger; member_events table monthly-partitioned + audit fields + rotation functions; system Member row + self-bootstrap event. `web/src/lib/system-member.ts` mirrors the SQL constants. 38 file-shape assertions passing. **Going-forward rule:** all migration filenames must match `^\d+_[a-z0-9_]+\.sql$` — enforced by the test suite.
- **T043 — Action layer scaffold + `member.create` handler.** Build complete 2026-05-10. New `web/src/actions/` tree: `_lib/{errors,context,handler,db,audit,event-log,handle-derivation}.ts` + `member/{index,create}.ts` + `index.ts` registry. `web/src/lib/action-context.ts` resolver. `web/scripts/check-action-layer-conformance.ts` greps for direct writes; wired as `npm run check:action-layer`. New deps: `pg`, `@types/pg`, `zod`, `tsx`. Transaction wrapper uses `pg.Pool` directly + `BEGIN/COMMIT/ROLLBACK` (Supabase JS lacks transactions). Tests: 59/60 sandbox-side; full Vitest run + DB-runtime assertions land via Playwright eval.
- **T044 — Supabase Auth signup hook.** Build complete 2026-05-10. Migration `006_auth_signup_hook.sql` enables `pg_net` + `pgcrypto`, defines `handle_new_auth_user()` (security-definer, HMAC-SHA256 signs payload, fires `net.http_post` async to a Next.js route), attaches AFTER INSERT trigger on `auth.users`. Route at `web/src/app/api/internal/auth-signup/route.ts` (Node runtime) validates signature via constant-time HMAC compare, invokes `member.create` with `actingMemberId='self-bootstrap'`, maps ActionError → HTTP status. Sentinel-proxy fix to `web/src/lib/action-context.ts` (T043 was leaking pool clients). 33 sandbox file-shape assertions + ~28 Vitest route-mock assertions. Phase 0 exit criterion verifiable end-to-end via Playwright eval (helpers pending).

## Phase 0 Status: BUILD COMPLETE 2026-05-10

All four Phase 0 tickets (T041–T044) have shipped build-side with passing file-shape and unit tests. Runtime verification of the full Phase 0 exit criterion (`spawn fresh auth.users → members row + member.created event with correct audit fields`) is the Playwright eval at `web/evals/phase-0/floor.spec.ts`, which runs end-to-end once the eval helper RPCs (`eval_member_create_with_failure_injection`, `eval_seed_handle_collision_range`, etc.) are provisioned — flagged as a separate stage.

Phase 0 substrate now installed:
- pgvector + postgis extensions
- Members table (b1 T1 column set) + RLS + indexes + trigger
- member_events partitioned event log + audit fields + rotation functions
- System Member row + self-bootstrap event
- Action layer (`web/src/actions/`) with `defineHandler` factory, transaction wrapper, audit injector, event-log writer, error taxonomy, registry
- `member.create` proof-of-pattern handler with collision-suffix logic
- Conformance-check script (`npm run check:action-layer`)
- Auth signup hook (Postgres trigger → Next.js route → `member.create`)

Ready for Phase 1 re-ticketing (T045+) per the rebuild plan.

After Phase 0 closes, Phase 1 re-ticketing (T045+) opens against the rebuild plan's full schema floor.

## Rebuild on Primitives — Phase 1 (Schema floor)

Phase 1 lands the primitive tables (locations, members augmentation, items, groups, discovery view) with RLS, indexes, action handlers, and event-log writers. Empty DB at the end; nothing user-visible yet.

**Phase 1 — Schema floor (in progress):**

- **T045 — Locations spine + 3 children + events.** Build complete 2026-05-11. Single migration `007_locations.sql` carrying: spine (`public.locations`, all b1 + reserved columns, four indexes incl. GIST on geography, RLS public-read + owner-update, no INSERT/DELETE policies); three child tables (`location_permanent`, `location_recurring_temporary`, `location_areas`) with per-child public-read mirrors on the spine's discoverability via EXISTS subquery; `sync_area_centroid()` security-definer trigger function that writes `ST_Centroid(polygon)` to the spine's geography on insert/update of `location_areas`; `public.location_events` partitioned monthly with the b1 emitted + reserved event_kind enum, audit fields (`acting_member_id` NOT NULL, `via_delegation_id` reserved), composite PK `(id, created_at)`, two indexes, owner-read RLS, and `ensure_location_events_partition` / `rotate_location_events_partitions` rotation functions seeded with current + 2 future months. 46 file-shape assertions passing (sandbox plain-node). Numbering note: rebuild plan called this `008_*`; renumbered to `007_*` per the Phase 1 dependency reorder — see DEVIATIONS.md. Commit `fab7fd9`.
- **T046 — Locations RLS fix-forward.** Build complete 2026-05-11. Migration `008_locations_owner_read.sql` lands the three corrective items the T045 M2 code review surfaced: (a) new `locations_owner_read` RLS policy closing the matrix per `location.md` line 165 (owners can now SELECT their own private + soft-deleted-protected rows); (b) `idx_locations_geog` swapped from full to partial (`where deleted_at is null`) matching `location.md` line 136 so soft-deleted Locations don't bloat the proximity index; (c) `sync_area_centroid()` rewritten with `set search_path = public, extensions` for defensive robustness against Supabase's PostGIS-relocation pattern in newer distributions. 6 file-shape assertions passing (sandbox plain-node). The verification-ladder discussion from the same review is captured in `product/exploration/locally-owned-verification.md` and queued for `pipeline-product`.
- **T048 — Member interests + follows.** Build complete 2026-05-11. Single migration `010_member_interests_follows.sql`: (a) `public.member_interests` with composite PK `(member_id, tag)`, tag CHECK (lowercase alnum + hyphen, 1–60 chars), `idx_member_interests_tag` for inverse-lookup ("which Members declare `live-music`?"), public-read RLS only — interests power Item relevance + Group suggestion + locality-first index scoring, so they're public-by-default per the ticket Notes; (b) `public.member_follows` with composite PK `(follower_member_id, followed_member_id)`, table-level CHECK preventing self-follow, soft-unfollow via nullable `unfollowed_at`, two partial indexes (`idx_follows_followed_active` + `idx_follows_follower_active` — both `where unfollowed_at is null` for the two follower-direction surfaces), two RLS SELECT policies that OR per Postgres semantics — `member_follows_self_read` (owner sees both endpoints regardless of privacy) and `member_follows_public_read` (public visibility requires BOTH endpoints opt-in via `member_privacy.show_following` + `show_followers`, expressed as dual EXISTS subqueries on member_privacy). No INSERT/UPDATE/DELETE policies on either table — action-layer-only writes. 18 file-shape assertions passing (sandbox plain-node mirroring `web/tests/migrations-t048.test.ts`).
- **T047 — Members augmentation: FK + privacy + handle history.** Build complete 2026-05-11. Single migration `009_members_phase1.sql` carrying: (a) `members.home_location_id` FK to `public.locations(id) on delete set null` via the two-step `not valid` + `validate constraint` pattern; (b) `assert_member_id_in_auth_users()` constraint trigger (security definer, `search_path = public, auth`, DEFERRABLE INITIALLY DEFERRED) substituting for the impossible `members.id → auth.users(id)` FK — system-Member id is exempted explicitly inside the function body; (c) `public.member_privacy` per `member.md` Data-model-implications (eight columns with CHECK + default per ADR-9 opt-out posture) + `member_privacy_set_updated_at` trigger + owner-read + owner-update RLS (no INSERT/DELETE — action-layer-only; UPDATE policy carries explicit `with check` per M2 polish); (d) `create_member_privacy_defaults()` bootstrap trigger fires AFTER INSERT on `public.members`, inserting a defaults row keyed by `new.id` with `on conflict do nothing` (function carries `comment on function` per M2 polish); (e) explicit `member_privacy` backfill row for the system Member (bootstrap trigger fires only on future inserts); (f) `public.member_handle_history` T2-placeholder table (composite PK `(member_id, handle)`, handle CHECK regex + length, owner-read RLS only, no other indexes). NO `primary_group_id` FK — `public.groups` doesn't exist yet; deferred to a Phase 1 Members FK closeout ticket after T0NN-groups. **M2 code review PROCEED 2026-05-11** — three non-blocking suggestions applied as fast-follow (explicit `with check`; `comment on function`; trigger-ordering documentation in the migration header). 27 file-shape assertions passing (sandbox plain-node mirroring the Vitest suite at `web/tests/migrations-t047.test.ts`). Numbering: rebuild plan called this `007_*`; locations took 007/008 in the Phase 1 dependency reorder, so this lands as 009 — recorded in DEVIATIONS.md.

## Remaining b1 MVP Work

Three tickets close the marketplace loop. Recommended order:

1. **T025** — Vendor bulletin compose + delivery. Unblocks the pinned bulletin section in T024 (currently has nothing to render).
2. **T026** — Vendor founder dashboard. Backs the vendor recruitment pitch.
3. **T019** — Geocoding + pin confirmation. Trust hardening on registration; can run in parallel with T025/T026.

See [planning/bundles/b1-mvp.md](../planning/bundles/b1-mvp.md) for the full MVP definition and success metrics.

## Latest Commits

- T046: Locations RLS fix-forward (`008_locations_owner_read.sql`)
- T045: Locations spine + 3 children + events (Phase 1 — `007_locations.sql`) — `fab7fd9`
- T026: Vendor founder dashboard — `/you/vendor` Overview/Followers/Activity tabs, MetricCards + Sparklines, ListingHealth, Top Tasks aside, CSV export, migration 006 `rollup_vendor_stats_daily`
- T025: Vendor bulletin compose + delivery — `/you/vendor/bulletins/*`, fan-out API, mute, open/unsubscribe primitives, migration 005
- T024: Events-driven Home feed — `EventCard`, filter chips, pinned bulletin section, lazy `market_session` generation, click telemetry
- T023: `/you` restructure — Saved / Following / Settings tabs, Your Market row, vendor mode entry
- T021: Tide accent + CTA patterns — `AuthGateModal`, two-track nav, sticky mobile CTA, recruitment panel on Home
- T022: Foundational schema — events, vendor_bulletins, bulletin_deliveries, vendor_events, vendor_stats_daily; follows soft-delete
- T012–T018: Etsy-style feed pivot — schema, bottom nav, home feed, explore, market modal, vendor profile, follow + notifications
- T011: Report a concern form
- T010: Support button (heart toggle)
- T009: Shareable listing page with OG metadata
- T008: Business registration form
- T007: Business detail card with ownership badge
- T006: Map search by category and location
- T005: Pin clustering at low zoom levels
- T004: Map view with colored ownership pins
- T003: Authentication (sign-up, login, sign-out, middleware)
- T002: Database schema and types
- T001: Project initialization

## Blockers

(None)

## Notes

Next.js 16 + Tailwind v4 + Supabase + Mapbox GL JS. T024 added migration `004_system_runs.sql` and a new `/api/jobs/generate-market-sessions` endpoint — run `supabase db push` before first deploy. Latest test count: 51/51 passing post-T024.
