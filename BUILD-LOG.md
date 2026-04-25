# BUILD-LOG — mainstreetmarket/web

Last updated: 2026-04-25

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
| T026 | Vendor Founder Dashboard (T1) | ⬜ Open (b1) |
| T027 | Event Surfacing on Profiles | ⏸️ Deferred (b2) |

## Remaining b1 MVP Work

Three tickets close the marketplace loop. Recommended order:

1. **T025** — Vendor bulletin compose + delivery. Unblocks the pinned bulletin section in T024 (currently has nothing to render).
2. **T026** — Vendor founder dashboard. Backs the vendor recruitment pitch.
3. **T019** — Geocoding + pin confirmation. Trust hardening on registration; can run in parallel with T025/T026.

See [planning/bundles/b1-mvp.md](../planning/bundles/b1-mvp.md) for the full MVP definition and success metrics.

## Latest Commits

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
