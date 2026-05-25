import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Schema floor invariants (cross-surface index file)
// Source of truth: notes/migration-to-primitives.md § Phase 1 — Schema floor
//
// This file carries Phase 1 floor checks that are not surface-specific:
//  - Action-layer conformance check (T051) re-run against the Phase 1 tables.
//  - Cross-cutting RLS smoke (anon vs auth-self matrix) for tables introduced
//    by Phase 1 that the per-surface specs don't already exercise.
//
// Per-surface specs (one ticket per describe in each):
//   - members-augmentation.spec.ts          → T047 (FK + privacy + handle history)
//   - members-interests-follows.spec.ts     → T048
//   - members-affinities.spec.ts            → T049 (ADR-16)
//   - members-agent-assistance.spec.ts      → T050 (self-records, delegations, via_delegation FKs)
//   - locations.spec.ts                     → T045 + T046 (spine + 3 children + events + RLS fix-forward)
//
// PM NOTE: Phase 1 has no `planning/scenarios/F{NNN}-*.md` either — substrate-
// only work. The rebuild plan's "Exit criterion" paragraph for Phase 1 is the
// contract this spec set verifies end-to-end:
//   "all tables exist; RLS matrix passes; action-handler conformance check
//    passes (no write to *_events, members, items, locations, groups outside
//    the action layer); audit fields populated by handlers (CI assertion);
//    [discoverable_items refresh — DEFERRED, Items don't ship in Phase 1];
//    system Member is the acting_member_id for platform-emitted events."
//
// Items (009 series) + Groups (010 series) + discoverable_items (011) are
// Phase 2 build per the rebuild plan; this spec set deliberately scopes to
// Members + Locations + their supporting tables + the action-layer scaffold.
//
// Eval-writer firewall: no imports from web/src/. All DB reads via service-
// role + RPC helpers in web/supabase/test-helpers/. All HTTP reads via fetch
// against APP_BASE_URL.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let admin: SupabaseClient;
let anon: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

test.describe("Phase 1 — Schema floor (cross-surface)", () => {
  // ------------------------------------------------------------
  // Action-layer conformance — re-run against the Phase 1 surface
  // Source: notes/migration-to-primitives.md § Phase 1 exit criterion.
  // T051 (CI enforcement) shipped at Phase 0; Phase 1 added 6 new migrations
  // (007–012). The conformance check should still report `{ ok: true }`
  // because every Phase 1 write surface lives in the action layer.
  // ------------------------------------------------------------

  test.describe("Action-layer conformance (T051) against Phase 1 tables", () => {
    test("Given Phase 1 migrations have applied | When we read the captured conformance result | Then ok=true with zero violations", async () => {
      // Why: encodes ADR-7 (action layer is the only write surface) project-
      // wide. The Phase 1 tables (locations, location_*, member_privacy,
      // member_handle_history, member_interests, member_follows,
      // member_self_records, member_delegations; member_location_affinities
      // retired by T061 per ADR-21) must not be writable from outside
      // src/actions/. T051's `--json` pipeline captures the conformance
      // result during bootstrap.
      const { data, error } = await admin.rpc("eval_conformance_check_result");
      expect(error, "helper eval_conformance_check_result missing — run `npm run eval:bootstrap`").toBeNull();
      expect(data).toMatchObject({ ok: true, violations: [] });
    });
  });

  // ------------------------------------------------------------
  // Phase 1 surface table census — every table the plan lists is present.
  // A floor-level smoke that catches a missing migration on a fresh
  // `supabase db reset` before any per-surface assertion runs.
  // ------------------------------------------------------------

  test.describe("Table census — every Phase 1 floor table exists", () => {
    const PHASE_1_TABLES = [
      // T045 + T046 (locations 007/008)
      "locations",
      "location_permanent",
      "location_recurring_temporary",
      "location_areas",
      "location_events",
      // T047 (members augmentation 009)
      "member_privacy",
      "member_handle_history",
      // T048 (interests + follows 010)
      "member_interests",
      "member_follows",
      // T049 (affinities 011) retired by T061 per ADR-21 — entry removed.
      // T050 (agent assistance 012)
      "member_self_records",
      "member_delegations",
    ];

    for (const table of PHASE_1_TABLES) {
      test(`Given the migrations have applied | When we describe ${table} | Then it has at least one column`, async () => {
        const { data, error } = await admin.rpc("eval_table_shape", { p_table: table });
        expect(error).toBeNull();
        expect((data as unknown[]).length).toBeGreaterThan(0);
      });
    }
  });

  // ------------------------------------------------------------
  // Anon RLS sanity — anon cannot read tables that are owner-only.
  // The per-surface specs assert the matrix per table; this is a guard
  // that catches a missing `enable row level security` on any table.
  // ------------------------------------------------------------

  test.describe("Anon RLS sanity — owner-only Phase 1 tables reject anon select", () => {
    // Why: each table here encodes a different design decision. Centralizing
    // the anon-rejected sanity check prevents a regression where someone
    // forgets `alter table … enable row level security` on a future
    // augmentation and anon suddenly sees rows that should be owner-only.
    const OWNER_ONLY_TABLES: Array<{ name: string; intent: string }> = [
      // Why: ADR-9 opt-out privacy posture — Member's privacy settings are
      // never peer-visible.
      { name: "member_privacy", intent: "ADR-9 opt-out privacy posture" },
      // Why: T2 placeholder — handle history is owner-read only per spec.
      { name: "member_handle_history", intent: "T2 handle-history owner-read only" },
      // ADR-16 affinity-row privacy retired with T061 (member_location_affinities
      // dropped per ADR-21). Place-interest equivalent enforced by T062
      // (member_place_interests); test coverage moves there.
      // Why: agent-assistance substrate — exposing it peer-readable would let
      // bad actors enumerate which Members opted into agent assistance.
      { name: "member_self_records", intent: "Agent-assistance reconnaissance prevention" },
      // Why: delegations carry scopes; peer-read would be reconnaissance for
      // capability-misuse / prompt-injection.
      { name: "member_delegations", intent: "Delegation scopes are private substrate" },
    ];

    for (const { name, intent } of OWNER_ONLY_TABLES) {
      test(`Given anon has no auth.uid() | When anon selects from ${name} | Then RLS returns zero rows (${intent})`, async () => {
        const { data, error } = await anon.from(name).select("*").limit(1);
        // RLS hides rows rather than erroring for SELECT.
        expect(error).toBeNull();
        expect((data ?? []).length).toBe(0);
      });
    }
  });
});
