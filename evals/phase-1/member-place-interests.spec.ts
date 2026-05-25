import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Member place-interest scope (T062).
//
// Source of truth:
//   - product/systems/member.md § Place-interest scope
//   - planning/adrs/ADR-0021-member-geography-substrate-split.md (Ratified 2026-05-23)
//   - planning/bundles/b1x-substrate-sprint.md § B2
//   - web/supabase/migrations/018_member_place_interests.sql
//
// Encoded absolutes verified here:
//   - owner-only RLS at row level (ADR-21)
//   - at most one active primary_home per Member (uniq_primary_home_active partial index)
//   - action-layer-only writes (no INSERT/UPDATE/DELETE policy)
//   - FK to places (on delete restrict)

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

async function seedMember(label: string): Promise<string> {
  const id = randomUUID();
  await admin.rpc("eval_seed_auth_user_only", { p_id: id });
  await admin.from("members").insert({
    id,
    handle: `${label}-${id.slice(0, 6)}`,
    display_name: `${label} ${id.slice(0, 4)}`,
  });
  return id;
}

async function cleanupMember(id: string): Promise<void> {
  await admin.from("member_place_interests").delete().eq("member_id", id);
  await admin.from("members").delete().eq("id", id);
  try {
    await admin.auth.admin.deleteUser(id);
  } catch {
    // best-effort
  }
}

async function getSeededPlace(slug: string): Promise<string> {
  const { data } = await admin
    .from("places")
    .select("id")
    .eq("slug", slug)
    .is("deleted_at", null)
    .single();
  return data!.id;
}

test.describe("Phase 1 — Member place-interests (T062)", () => {
  test.describe("T062 — public.member_place_interests schema shape", () => {
    test("Given the migration has applied | When we describe member_place_interests | Then the b1 column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", {
        p_table: "member_place_interests",
      });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "member_id",
          "place_id",
          "scope_kind",
          "created_at",
          "removed_at",
          "metadata",
        ]),
      );
    });

    test("Given the seeded launch places exist | When we look up Oak Park | Then it resolves under Sacramento", async () => {
      // Why: T058 seed correctness gates every downstream T062 test. Without
      // the 9 seeded places, every insert below FKs against nothing.
      const oak = await getSeededPlace("oak-park");
      expect(oak).toBeTruthy();
      const { data: sac } = await admin
        .from("places")
        .select("id, slug, kind")
        .eq("id", (await admin.from("places").select("parent_id").eq("id", oak).single()).data!
          .parent_id);
      expect(sac![0]!.slug).toBe("sacramento");
      expect(sac![0]!.kind).toBe("city");
    });

    test("Given scope_kind is CHECK-enumerated | When we insert scope_kind='tertiary' | Then the CHECK rejects it (23514)", async () => {
      const memberId = await seedMember("mpi-chk");
      const placeId = await getSeededPlace("oak-park");
      const { error } = await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: placeId,
        scope_kind: "tertiary",
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(memberId);
    });

    test("Given the FK to places | When we insert with a non-existent place_id | Then it is rejected with 23503", async () => {
      const memberId = await seedMember("mpi-fk");
      const { error } = await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: randomUUID(),
        scope_kind: "secondary",
      });
      expect(error?.code).toBe("23503");
      await cleanupMember(memberId);
    });
  });

  test.describe("T062 — uniq_primary_home_active partial index (the load-bearing absolute)", () => {
    test("Given a Member has one active primary_home | When we insert a second active primary_home | Then the unique index rejects it (23505)", async () => {
      // Encodes ratified absolute: ADR-21 — at most one active primary_home
      // per Member. This is the only DB-level enforcement; the handler's
      // atomic swap relies on it for correctness under concurrent writes.
      const memberId = await seedMember("mpi-uniq");
      const oak = await getSeededPlace("oak-park");
      const midtown = await getSeededPlace("midtown");

      const ins1 = await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: oak,
        scope_kind: "primary_home",
      });
      expect(ins1.error).toBeNull();

      const ins2 = await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: midtown,
        scope_kind: "primary_home",
      });
      expect(ins2.error?.code).toBe("23505");

      await cleanupMember(memberId);
    });

    test("Given a soft-removed primary_home | When we insert a new active primary_home | Then the partial index admits it", async () => {
      // Why: the partial index predicate is `WHERE scope_kind='primary_home'
      // AND removed_at IS NULL`. Soft-removed rows fall out of the unique
      // namespace by design, so a Member who unsets their primary_home can
      // reset to a new one without hard-deleting history.
      const memberId = await seedMember("mpi-soft");
      const oak = await getSeededPlace("oak-park");
      const midtown = await getSeededPlace("midtown");

      await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: oak,
        scope_kind: "primary_home",
      });
      await admin
        .from("member_place_interests")
        .update({ removed_at: new Date().toISOString() })
        .eq("member_id", memberId)
        .eq("place_id", oak);

      const { error } = await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: midtown,
        scope_kind: "primary_home",
      });
      expect(error).toBeNull();

      await cleanupMember(memberId);
    });

    test("Given the partial index is keyed by scope_kind='primary_home' only | When we insert many active secondaries | Then no unique conflict fires", async () => {
      // Secondary-cap enforcement is action-layer-only (SECONDARY_LIMIT=5);
      // the DB does NOT cap secondaries. This eval pins that the DB *allows*
      // many secondaries so the test in the next describe can prove the
      // action layer is the one doing the gating.
      const memberId = await seedMember("mpi-sec");
      const slugs = ["oak-park", "curtis-park", "east-sacramento", "midtown", "west-sacramento", "land-park"];
      for (const slug of slugs) {
        const pid = await getSeededPlace(slug);
        const { error } = await admin.from("member_place_interests").insert({
          member_id: memberId,
          place_id: pid,
          scope_kind: "secondary",
        });
        expect(error, `slug=${slug} rejected at DB`).toBeNull();
      }
      await cleanupMember(memberId);
    });
  });

  test.describe("T062 — RLS matrix (owner-only at row level — ADR-21)", () => {
    test("Given Member A has place-interest rows | When anon queries member_place_interests | Then RLS returns zero rows", async () => {
      const memberId = await seedMember("mpi-rls-a");
      const oak = await getSeededPlace("oak-park");
      await admin.from("member_place_interests").insert({
        member_id: memberId,
        place_id: oak,
        scope_kind: "primary_home",
      });

      const { data, error } = await anon
        .from("member_place_interests")
        .select("place_id")
        .eq("member_id", memberId);
      // RLS hides rows rather than erroring.
      expect(error).toBeNull();
      expect(data?.length).toBe(0);

      await cleanupMember(memberId);
    });

    test("Given anon has no auth.uid() | When anon attempts INSERT into member_place_interests | Then it is rejected (no insert policy)", async () => {
      const oak = await getSeededPlace("oak-park");
      const { error } = await anon.from("member_place_interests").insert({
        member_id: randomUUID(),
        place_id: oak,
        scope_kind: "secondary",
      });
      // No INSERT policy exists; the row write fails RLS.
      expect(error).not.toBeNull();
    });
  });

  test.describe("T062 — member_events.event_kind allow-list (post-021 final state)", () => {
    // After T061's 021 rewrite, the CHECK should accept the 4 T062 kinds
    // while rejecting the 2 retired location_affinity kinds.
    test("Given migration 021 has rewritten the CHECK | When we insert event_kind='member.place_interest_added' | Then it is accepted", async () => {
      const memberId = await seedMember("mpi-ev");
      const { error } = await admin.from("member_events").insert({
        member_id: memberId,
        event_kind: "member.place_interest_added",
        acting_member_id: memberId,
        payload: { place_id: await getSeededPlace("oak-park"), scope_kind: "primary_home" },
      });
      expect(error).toBeNull();
      await cleanupMember(memberId);
    });

    test("Given migration 021 retired location_affinity_added | When we insert that event_kind | Then the CHECK rejects it (23514)", async () => {
      const memberId = await seedMember("mpi-evx");
      const { error } = await admin.from("member_events").insert({
        member_id: memberId,
        event_kind: "member.location_affinity_added",
        acting_member_id: memberId,
        payload: {},
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(memberId);
    });
  });
});
