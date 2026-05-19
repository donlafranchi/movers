import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Member location affinities (ADR-16)
// Source of truth:
//   - notes/migration-to-primitives.md § Phase 1 — Member surface
//   - product/systems/member.md lines 261-306 (multi-Location belonging)
//   - planning/DECISIONS.md ADR-16 (per-row privacy on member_location_affinities)
//   - planning/DECISIONS.md ADR-7  (action-layer-only writes)
// Ticket: T049 — Member location affinities (011_member_location_affinities.sql).
//
// ADR-16 three-layer architecture verified here:
//   Layer 1 — RLS owner-only on the table.
//   Layer 2 — Three SECURITY DEFINER scalar functions are the public access
//             catalog (member_is_local_to_location, count_likes_for_location,
//             count_followers_for_location).
//   Layer 3 — service_role bypasses RLS for backend pipelines (asserted via
//             the service-role client reading the rows it writes).

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

test.describe("Phase 1 — Member location affinities (T049 / ADR-16)", () => {
  // ------------------------------------------------------------
  // T049 — table shape + composite PK + CHECK + indexes
  // ------------------------------------------------------------

  test.describe("T049 — public.member_location_affinities table shape", () => {
    test("Given the migration has applied | When we describe the table | Then (member_id, location_id, affinity_kind, created_at, removed_at) are present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", {
        p_table: "member_location_affinities",
      });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining(["member_id", "location_id", "affinity_kind", "created_at", "removed_at"]),
      );
    });

    test("Given the affinity_kind enum is locked | When we attempt to insert affinity_kind='wanders' | Then the CHECK rejects it", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `aff-${memberId.slice(0, 6)}`, display_name: "Aff Probe" });

      const slug = `aff-loc-${memberId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: memberId,
          kind: "permanent",
          label: "Probe Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      // Why: member.md / ADR-16 — the six affinity_kind values are locked
      // because each one carries a different privacy and surface
      // implication. Adding a new kind without a coordinated review of
      // surfaces and SECURITY DEFINER catalog would silently widen the
      // attack surface.
      const { error } = await admin.from("member_location_affinities").insert({
        member_id: memberId,
        location_id: locId,
        affinity_kind: "wanders",
      });
      expect(error?.code).toBe("23514");

      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the three partial indexes serve distinct surfaces | When we list indexes | Then all three exist with correct partial predicates", async () => {
      const { data, error } = await admin.rpc("eval_indexes_for_table", {
        p_table: "member_location_affinities",
      });
      expect(error).toBeNull();
      const idx = data as Array<{ indexname: string; indexdef: string }>;
      const memberActive = idx.find((r) => r.indexname === "idx_affinity_member_active");
      const followers = idx.find((r) => r.indexname === "idx_affinity_location_followers");
      const locals = idx.find((r) => r.indexname === "idx_affinity_location_locals");

      // Why: member.md lines 274-280 — the three surfaces (Member-own,
      // Location-followers feed, locally-owned derivation) each need a
      // partial index keyed on `where removed_at is null` plus a kind
      // filter where applicable. Asserting both presence and the partial
      // predicate prevents a regression where the predicate is dropped.
      expect(memberActive?.indexdef).toMatch(/where \(removed_at is null\)/i);
      expect(followers?.indexdef).toMatch(/where \(\(affinity_kind = 'follows'/i);
      expect(locals?.indexdef).toMatch(/affinity_kind = any \(array\['lives'/i);
    });
  });

  // ------------------------------------------------------------
  // ADR-16 Layer 1 — RLS owner-only
  // ------------------------------------------------------------

  test.describe("ADR-16 Layer 1 — RLS owner-only", () => {
    test("Given a Member owns affinity rows | When anon attempts to read | Then RLS returns zero rows for all six kinds", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `rls-${memberId.slice(0, 6)}`, display_name: "RLS Probe" });

      const slug = `rls-loc-${memberId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: memberId,
          kind: "permanent",
          label: "RLS Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      const kinds = ["lives", "works", "plays", "visits", "follows", "liked"] as const;
      for (const k of kinds) {
        await admin.from("member_location_affinities").insert({
          member_id: memberId,
          location_id: locId,
          affinity_kind: k,
        });
      }

      // Why: ADR-16 Layer 1 — `lives`/`works` are obviously sensitive
      // (someone watching the platform could derive the Member's home or
      // workplace). `liked`/`follows`/`plays`/`visits` narrow geography
      // for a patient observer too, so all six get owner-only treatment.
      const { data: anonData, error: anonErr } = await anon
        .from("member_location_affinities")
        .select("affinity_kind")
        .eq("member_id", memberId);
      expect(anonErr).toBeNull();
      expect(anonData).toEqual([]);

      // Cleanup
      await admin.from("member_location_affinities").delete().eq("member_id", memberId);
      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the table has no insert/update/delete policy | When anon attempts INSERT | Then RLS rejects (action-layer-only)", async () => {
      // Why: ADR-7 — affinity writes flow through member.location_affinity.add
      // / .remove + member.locality.set. Direct anon writes must fail; the
      // action layer is the only path that emits the corresponding event-log
      // entry in the same transaction.
      const { error } = await anon.from("member_location_affinities").insert({
        member_id: randomUUID(),
        location_id: randomUUID(),
        affinity_kind: "lives",
      });
      expect(error, "anon insert into member_location_affinities must fail").not.toBeNull();
    });
  });

  // ------------------------------------------------------------
  // ADR-16 Layer 2 — SECURITY DEFINER access catalog
  // ------------------------------------------------------------

  test.describe("ADR-16 Layer 2 — SECURITY DEFINER access catalog", () => {
    test("Given a Member with no `lives`/`works` affinity at L | When anon calls member_is_local_to_location | Then false", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `loc1-${memberId.slice(0, 6)}`, display_name: "Local Probe" });

      const slug = `loc1-loc-${memberId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: memberId,
          kind: "permanent",
          label: "Local Probe Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      const { data, error } = await anon.rpc("member_is_local_to_location", {
        p_member_id: memberId,
        p_location_id: locId,
      });
      // Why: ADR-16 Layer 2 — the catalog returns false rather than
      // erroring on missing data. Anon must be able to call it without
      // learning anything beyond the boolean.
      expect(error).toBeNull();
      expect(data).toBe(false);

      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given a Member with `lives` affinity at L | When anon calls member_is_local_to_location | Then true (cross-Member peek via narrow scalar)", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `loc2-${memberId.slice(0, 6)}`, display_name: "Local True" });

      const slug = `loc2-loc-${memberId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: memberId,
          kind: "permanent",
          label: "Local True Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      await admin.from("member_location_affinities").insert({
        member_id: memberId,
        location_id: locId,
        affinity_kind: "lives",
      });

      // Why: ADR-16 Layer 2 — the locality derivation is the canonical
      // cross-Member peek. Anon learns "yes, M is local to L" (a boolean)
      // without learning M's other affinities or whether M lives or works
      // there. The catalog returns a narrow scalar.
      const { data, error } = await anon.rpc("member_is_local_to_location", {
        p_member_id: memberId,
        p_location_id: locId,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);

      await admin.from("member_location_affinities").delete().eq("member_id", memberId);
      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given soft-removed `lives` affinity (removed_at IS NOT NULL) | When anon calls member_is_local_to_location | Then false", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `loc3-${memberId.slice(0, 6)}`, display_name: "Local Removed" });

      const slug = `loc3-loc-${memberId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: memberId,
          kind: "permanent",
          label: "Local Removed Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      await admin.from("member_location_affinities").insert({
        member_id: memberId,
        location_id: locId,
        affinity_kind: "lives",
        removed_at: new Date().toISOString(),
      });

      // Why: ADR-16 Layer 2 — soft-remove semantics. The catalog functions
      // all filter `where removed_at is null`, so a removed affinity stops
      // qualifying immediately. A regression that dropped this filter
      // would let a previously-local Member be marked local forever.
      const { data, error } = await anon.rpc("member_is_local_to_location", {
        p_member_id: memberId,
        p_location_id: locId,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);

      await admin.from("member_location_affinities").delete().eq("member_id", memberId);
      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given two Members each `liked` Location L | When anon calls count_likes_for_location | Then 2 (aggregate, never per-Member attribution)", async () => {
      const m1 = randomUUID();
      const m2 = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: m1 });
      await admin.rpc("eval_seed_auth_user_only", { p_id: m2 });
      await admin.from("members").insert([
        { id: m1, handle: `lik1-${m1.slice(0, 6)}`, display_name: "Liker One" },
        { id: m2, handle: `lik2-${m2.slice(0, 6)}`, display_name: "Liker Two" },
      ]);

      const slug = `lik-loc-${m1.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: m1,
          kind: "permanent",
          label: "Like Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      await admin.from("member_location_affinities").insert([
        { member_id: m1, location_id: locId, affinity_kind: "liked" },
        { member_id: m2, location_id: locId, affinity_kind: "liked" },
      ]);

      // Why: ADR-16 Layer 2 — aggregate functions are the anonymizer. The
      // Location-page rollup ("N Members liked this place") is the only
      // public surface for `liked` data; per-Member attribution would
      // re-introduce the doxxing surface area that owner-only RLS closes.
      const { data, error } = await anon.rpc("count_likes_for_location", { p_location_id: locId });
      expect(error).toBeNull();
      expect(data).toBe(2);

      await admin.from("member_location_affinities").delete().eq("location_id", locId);
      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().in("id", [m1, m2]);
      await cleanupAuthUsers([m1, m2]);
    });

    test("Given Members `follow` Location L | When anon calls count_followers_for_location | Then the active-follower count", async () => {
      const m1 = randomUUID();
      const m2 = randomUUID();
      const m3 = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: m1 });
      await admin.rpc("eval_seed_auth_user_only", { p_id: m2 });
      await admin.rpc("eval_seed_auth_user_only", { p_id: m3 });
      await admin.from("members").insert([
        { id: m1, handle: `flw1-${m1.slice(0, 6)}`, display_name: "F1" },
        { id: m2, handle: `flw2-${m2.slice(0, 6)}`, display_name: "F2" },
        { id: m3, handle: `flw3-${m3.slice(0, 6)}`, display_name: "F3" },
      ]);

      const slug = `flw-loc-${m1.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: m1,
          kind: "permanent",
          label: "Follow Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      await admin.from("member_location_affinities").insert([
        { member_id: m1, location_id: locId, affinity_kind: "follows" },
        { member_id: m2, location_id: locId, affinity_kind: "follows" },
        { member_id: m3, location_id: locId, affinity_kind: "follows", removed_at: new Date().toISOString() },
      ]);

      // Why: ADR-16 Layer 2 + soft-remove — the count must filter `where
      // removed_at is null` (only m1, m2 are active followers; m3 is
      // soft-removed). Regression that included removed rows would
      // overstate the "Concerts in the Park" follower count.
      const { data, error } = await anon.rpc("count_followers_for_location", { p_location_id: locId });
      expect(error).toBeNull();
      expect(data).toBe(2);

      await admin.from("member_location_affinities").delete().eq("location_id", locId);
      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().in("id", [m1, m2, m3]);
      await cleanupAuthUsers([m1, m2, m3]);
    });
  });

  // ------------------------------------------------------------
  // ADR-16 Layer 3 — service_role bypasses RLS (backend pipelines)
  // ------------------------------------------------------------

  test.describe("ADR-16 Layer 3 — service_role read", () => {
    test("Given affinity rows exist | When the service-role client SELECTs | Then it reads them (RLS bypass for backend pipelines)", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `svc-${memberId.slice(0, 6)}`, display_name: "Service Read" });

      const slug = `svc-loc-${memberId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: memberId,
          kind: "permanent",
          label: "Service Loc",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      await admin.from("member_location_affinities").insert({
        member_id: memberId,
        location_id: locId,
        affinity_kind: "lives",
      });

      // Why: ADR-16 Layer 3 — service_role bypasses RLS for the
      // recommendation engine + embedding pipeline. Asserting this is the
      // canonical "the backend can still see it" check; outputs to users
      // from this layer must always be anonymized aggregates.
      const { data, error } = await admin
        .from("member_location_affinities")
        .select("affinity_kind")
        .eq("member_id", memberId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      await admin.from("member_location_affinities").delete().eq("member_id", memberId);
      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });
  });
});

async function cleanupAuthUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // Best-effort.
    }
  }
}
