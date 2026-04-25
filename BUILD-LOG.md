# BUILD-LOG — mainstreetmarket/web

Last updated: 2026-04-09

Development agent's build progress tracker. Use JOURNAL.md for product/strategy notes.

## Current Release

**Target:** b1 MVP
**Start Date:** 2026-04-09

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
| T014 | Home Feed (Etsy-style) | ✅ Complete |
| T015 | Explore — Search + List/Map | ✅ Complete |
| T016 | Market Selection Modal | ✅ Complete |
| T017 | Vendor Profile Update | ✅ Complete |
| T018 | Follow Vendor + Notifications | ✅ Complete |
| T022 | Foundational Schema (events, bulletins, vendor analytics, follow soft-delete) | ✅ Complete |
| T021 | Tide accent + CTA pattern rollout (auth-gate modal, sticky mobile CTA, recruitment panels) | ✅ Complete |
| T023 | You page restructure (Saved/Following/Settings tabs, Your Market row, vendor mode link) | ✅ Complete |
| T024 | Events-driven Home feed (EventCard, filter chips, pinned bulletins, lazy session generation) | ✅ Complete |

## Latest Commits

- T024: Events-driven Home feed — EventCard, filter chips, pinned bulletins, lazy market_session generation
- T023: You page restructure — Saved/Following/Settings tabs, Your Market row, vendor mode entry
- T021: Tide accent + CTA patterns — AuthGateModal, two-track nav, sticky mobile CTA, recruitment panel on Home
- T022: Foundational schema — events, vendor_bulletins, bulletin_deliveries, vendor_events, vendor_stats_daily; follows soft-delete
- T012-T018: Etsy-style feed pivot — schema, bottom nav, home feed, explore, market modal, vendor profile, follow + notifications


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

Next.js 16 + Tailwind v4 + Supabase + Mapbox GL JS. All scripts verified (dev, build, test, eval). 83 Playwright eval tests ready.
