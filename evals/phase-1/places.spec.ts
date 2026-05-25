import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Places primitive (T058).
//
// Source of truth:
//   - product/systems/places.md
//   - planning/adrs/ADR-0020-locality-scoped-urls.md (Accepted 2026-05-23)
//   - planning/bundles/b1x-substrate-sprint.md § A1
//   - web/supabase/migrations/017_places.sql
//
// Encoded absolutes verified here:
//   - "Places are platform-curated, not user-created" (ADR-20:173)
//       → public-read SELECT policy + no INSERT/UPDATE/DELETE policy.
//   - Parent-scoped slug uniqueness (places.md § The Hierarchy)
//       → composite UNIQUE (parent_id, slug) + partial UNIQUE for NULL parent.
//   - Hierarchical kinds (region / state / county / city / neighborhood).
//   - Launch-locality seed (13 rows; California → 5 counties → Sacramento city → 6 neighborhoods).

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let admin: SupabaseClient;
let anon: SupabaseClient;

// Serial mode — several tests insert/cleanup temporary places by slug.
// fullyParallel would let one test's test-twin-slug row appear in another
// test's neighborhood listing.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

test.describe("Phase 1 — Places (T058)", () => {
  test.describe("T058 — public.places schema shape", () => {
    test("Given the migration has applied | When we describe places | Then the b1 column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "places" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "parent_id",
          "slug",
          "display_name",
          "kind",
          "geography",
          "iso_country_code",
          "metadata",
          "created_at",
          "updated_at",
          "deleted_at",
        ]),
      );
    });

    test("Given the kind CHECK | When we insert kind='msa' (retired in favor of county) | Then the CHECK rejects it (23514)", async () => {
      // Why: ADR-20's kind enum (region/state/county/city/neighborhood)
      // reserves kind to the five enumerated levels. MSA was considered
      // but swapped for County before merge. New levels are platform
      // decisions that ride an ADR + spec update, never an ad-hoc insert.
      const { error } = await admin.from("places").insert({
        slug: "test-bad-kind",
        display_name: "Bad Kind Test",
        kind: "msa",
      });
      expect(error?.code).toBe("23514");
    });

    test("Given the slug regex CHECK | When we insert slug='Has Spaces' | Then the CHECK rejects it (23514)", async () => {
      const { error } = await admin.from("places").insert({
        slug: "Has Spaces",
        display_name: "Spaces Test",
        kind: "city",
      });
      expect(error?.code).toBe("23514");
    });
  });

  test.describe("T058 — parent-scoped slug uniqueness (ADR-20 absolute)", () => {
    test("Given two distinct parents | When we insert the same slug under each | Then both succeed (the 'two Oak Parks' case)", async () => {
      // The load-bearing test for the parent-scoping decision. Without it,
      // ADR-20 falls back to global slug uniqueness and the URL namespace
      // becomes a land-grab.
      const { data: ca } = await admin.from("places").select("id").eq("slug", "ca").single();
      const tempState = await admin
        .from("places")
        .insert({
          slug: "il", // mirror the 2-letter USPS slug convention per ADR-0022
          display_name: "Illinois (test)",
          kind: "state",
          iso_country_code: "US",
        })
        .select("id")
        .single();
      expect(tempState.error).toBeNull();

      // Same slug 'test-twin-slug' under Sacramento (city) and Illinois (test).
      const sacCityId = (
        await admin
          .from("places")
          .select("id")
          .eq("slug", "sacramento")
          .eq("kind", "city")
          .single()
      ).data!.id;
      const ins1 = await admin.from("places").insert({
        parent_id: sacCityId,
        slug: "test-twin-slug",
        display_name: "Twin (Sacramento)",
        kind: "neighborhood",
      });
      const ins2 = await admin.from("places").insert({
        parent_id: tempState.data!.id,
        slug: "test-twin-slug",
        display_name: "Twin (Illinois)",
        kind: "county",
      });
      expect(ins1.error).toBeNull();
      expect(ins2.error).toBeNull();

      // Cleanup.
      await admin
        .from("places")
        .delete()
        .in("slug", ["test-twin-slug", "il"]);
      // CA stays put.
      expect(ca!.id).toBeTruthy();
    });

    test("Given a sibling slug already exists under the same parent | When we insert a duplicate | Then it is rejected (23505)", async () => {
      const sacCityId = (
        await admin
          .from("places")
          .select("id")
          .eq("slug", "sacramento")
          .eq("kind", "city")
          .single()
      ).data!.id;
      const { error } = await admin.from("places").insert({
        parent_id: sacCityId,
        slug: "oak-park", // already seeded under Sacramento city
        display_name: "Duplicate Oak Park",
        kind: "neighborhood",
      });
      expect(error?.code).toBe("23505");
    });

    test("Given the NULL-parent root uniqueness partial index | When two NULL-parent rows share a slug | Then the second is rejected", async () => {
      // Postgres composite UNIQUE treats NULL as distinct, so without the
      // partial unique index two California-slugged top-levels could
      // coexist. Verifies the partial index installed in 017_places.sql.
      const { error } = await admin.from("places").insert({
        slug: "ca", // collision with the seeded state row
        display_name: "California (dup attempt)",
        kind: "state",
        iso_country_code: "US",
      });
      expect(error?.code).toBe("23505");
    });
  });

  test.describe("T058 — RLS posture (platform-curated absolute)", () => {
    test("Given the migration has applied | When anon queries places | Then non-deleted rows ARE returned (public-read)", async () => {
      // 'sacramento' is shared by the county + the city — both are visible
      // to anon (no privacy posture against place curation history).
      const { data, error } = await anon
        .from("places")
        .select("slug, kind")
        .eq("slug", "sacramento")
        .is("deleted_at", null);
      expect(error).toBeNull();
      expect(data?.length).toBe(2);
      expect(data?.map((d) => d.kind).sort()).toEqual(["city", "county"]);
    });

    test("Given the absence of INSERT policy | When anon attempts to INSERT a place | Then it is rejected (platform-curated)", async () => {
      // Encodes ADR-20:173 absolute. The anti-land-grab gate at the URL layer.
      const { error } = await anon.from("places").insert({
        slug: "anon-cant-create",
        display_name: "Land Grab",
        kind: "neighborhood",
      });
      expect(error).not.toBeNull();
    });

    test("Given the absence of UPDATE policy | When anon attempts to rename a seeded place | Then it is rejected", async () => {
      const { data: sac } = await anon
        .from("places")
        .update({ display_name: "Hijacked" })
        .eq("slug", "sacramento")
        .select("id");
      // RLS-blocked UPDATE returns empty data without error.
      expect(sac?.length ?? 0).toBe(0);
    });

    test("Given a soft-deleted place would exist | When anon queries it | Then deleted_at IS NULL filter applies in the SELECT policy", async () => {
      // Why: ADR-20 + places.md — superseded places are soft-removed; their
      // URL should 404 immediately (the public read policy enforces this).
      // This test pins the SELECT policy predicate.
      // Set up: admin soft-deletes a temp row, anon queries should not see it.
      const tempId = randomUUID();
      const ca = (await admin.from("places").select("id").eq("slug", "ca").single())
        .data!.id;
      // Insert as a county (state-parented) so the city-must-have-state
      // CHECK doesn't apply and the trigger sets ancestor_state_id cleanly.
      await admin.from("places").insert({
        id: tempId,
        parent_id: ca,
        slug: "test-sd-rls",
        display_name: "Soft-delete RLS test",
        kind: "county",
      });
      await admin.from("places").update({ deleted_at: new Date().toISOString() }).eq("id", tempId);

      const { data } = await anon.from("places").select("id").eq("id", tempId);
      expect(data?.length).toBe(0);

      await admin.from("places").delete().eq("id", tempId);
    });
  });

  test.describe("T058 — launch-locality seed (13 rows: 1 state + 5 counties + 2 cities + 5 neighborhoods)", () => {
    test("Given the migration has applied | When we look up California by slug 'ca' | Then it is the NULL-parent state root", async () => {
      const { data: ca } = await admin
        .from("places")
        .select("id, parent_id, kind, display_name")
        .eq("slug", "ca")
        .is("deleted_at", null)
        .single();
      expect(ca!.parent_id).toBeNull();
      expect(ca!.kind).toBe("state");
      // Display name unchanged from the pre-ADR-0022 seed — only the slug
      // moved to the USPS form.
      expect(ca!.display_name).toBe("California");
    });

    test("Given California has 5 seeded counties | When we list them | Then the b1 metro counties are present", async () => {
      const { data: ca } = await admin
        .from("places")
        .select("id")
        .eq("slug", "ca")
        .is("deleted_at", null)
        .single();
      const { data: counties } = await admin
        .from("places")
        .select("slug")
        .eq("parent_id", ca!.id)
        .eq("kind", "county")
        .is("deleted_at", null);
      expect(counties?.map((c) => c.slug).sort()).toEqual(
        ["el-dorado", "placer", "sacramento", "sutter", "yolo"],
      );
    });

    test("Given Sacramento County and Sacramento (city) share the slug | When we resolve each by parent_id | Then they are distinct rows with the correct kinds", async () => {
      // Encodes ADR-20 parent-scoped slug uniqueness: same slug under
      // different parents is admitted by the composite UNIQUE.
      const { data: ca } = await admin
        .from("places")
        .select("id")
        .eq("slug", "ca")
        .is("deleted_at", null)
        .single();
      const { data: county } = await admin
        .from("places")
        .select("id, kind")
        .eq("slug", "sacramento")
        .eq("kind", "county")
        .eq("parent_id", ca!.id)
        .is("deleted_at", null)
        .single();
      const { data: city } = await admin
        .from("places")
        .select("id, kind")
        .eq("slug", "sacramento")
        .eq("kind", "city")
        .eq("parent_id", county!.id)
        .is("deleted_at", null)
        .single();
      expect(county!.id).not.toBe(city!.id);
      expect(county!.kind).toBe("county");
      expect(city!.kind).toBe("city");
    });

    test("Given West Sacramento is correctly seeded as a Yolo County city (ADR-0022 § Consequences) | When we resolve it | Then its parent is Yolo County, not Sacramento city", async () => {
      const { data: ca } = await admin
        .from("places")
        .select("id")
        .eq("slug", "ca")
        .single();
      const { data: yolo } = await admin
        .from("places")
        .select("id")
        .eq("slug", "yolo")
        .eq("kind", "county")
        .eq("parent_id", ca!.id)
        .single();
      const { data: wsac } = await admin
        .from("places")
        .select("id, parent_id, kind, ancestor_state_id")
        .eq("slug", "west-sacramento")
        .single();
      expect(wsac!.kind).toBe("city");
      expect(wsac!.parent_id).toBe(yolo!.id);
      expect(wsac!.ancestor_state_id).toBe(ca!.id);
    });

    test("Given Sacramento (city) has 5 seeded neighborhoods | When we list them | Then they match places.md § T1 (west-sacramento moved to Yolo)", async () => {
      const { data: ca } = await admin
        .from("places")
        .select("id")
        .eq("slug", "ca")
        .is("deleted_at", null)
        .single();
      const { data: county } = await admin
        .from("places")
        .select("id")
        .eq("slug", "sacramento")
        .eq("kind", "county")
        .eq("parent_id", ca!.id)
        .is("deleted_at", null)
        .single();
      const { data: city } = await admin
        .from("places")
        .select("id")
        .eq("slug", "sacramento")
        .eq("kind", "city")
        .eq("parent_id", county!.id)
        .is("deleted_at", null)
        .single();
      const { data: nbrhd } = await admin
        .from("places")
        .select("slug")
        .eq("parent_id", city!.id)
        .eq("kind", "neighborhood")
        .is("deleted_at", null);
      expect(nbrhd?.map((n) => n.slug).sort()).toEqual(
        [
          "curtis-park",
          "east-sacramento",
          "land-park",
          "midtown",
          "oak-park",
        ].sort(),
      );
    });
  });

  test.describe("T058 — state-scoped city uniqueness (ADR-0022)", () => {
    test("Given Sacramento city already exists in CA | When we insert another Sacramento city under a different CA county | Then the state-scoped UNIQUE rejects it (23505)", async () => {
      // Encodes ADR-0022 § Consequences — state-scoped city uniqueness.
      // Two cities of the same slug in different counties of the same
      // state would surface as URL ambiguity at /p/ca/sacramento, so the
      // partial UNIQUE (ancestor_state_id, slug) WHERE kind='city' fires.
      const { data: ca } = await admin.from("places").select("id").eq("slug", "ca").single();
      const { data: yolo } = await admin
        .from("places")
        .select("id")
        .eq("slug", "yolo")
        .eq("kind", "county")
        .eq("parent_id", ca!.id)
        .single();
      const { error } = await admin.from("places").insert({
        parent_id: yolo!.id,
        slug: "sacramento", // already a city under Sacramento County in the same state
        display_name: "Sacramento (Yolo dup attempt)",
        kind: "city",
      });
      expect(error?.code).toBe("23505");
    });

    test("Given the city-must-have-state CHECK | When we attempt to insert a city without an ancestor state | Then the CHECK fires", async () => {
      // The trigger leaves ancestor_state_id NULL when the parent chain
      // contains no state — e.g., a city directly under a region or NULL.
      // The CHECK constraint then rejects.
      const { error } = await admin.from("places").insert({
        parent_id: null,
        slug: "orphan-city",
        display_name: "Orphan City",
        kind: "city",
      });
      // 23514 = CHECK violation.
      expect(error?.code).toBe("23514");
    });
  });

  test.describe("T058 — ancestor_state_id trigger (ADR-0022)", () => {
    test("Given a neighborhood deep under California | When we read its row | Then ancestor_state_id is California's id", async () => {
      const { data: ca } = await admin
        .from("places")
        .select("id")
        .eq("slug", "ca")
        .single();
      const { data: oak } = await admin
        .from("places")
        .select("ancestor_state_id, kind")
        .eq("slug", "oak-park")
        .single();
      expect(oak!.ancestor_state_id).toBe(ca!.id);
    });

    test("Given a state row | When we read its ancestor_state_id | Then it is NULL (the state has no state ancestor)", async () => {
      const { data: ca } = await admin
        .from("places")
        .select("ancestor_state_id")
        .eq("slug", "ca")
        .single();
      expect(ca!.ancestor_state_id).toBeNull();
    });
  });

  test.describe("T058 — place_events (ADR-10 partitioned event log)", () => {
    test("Given place_events is partitioned | When we ask pg_class | Then relkind='p' (partition parent)", async () => {
      const { data } = await admin.rpc("eval_is_partitioned", { p_table: "place_events" });
      expect(data).toBe(true);
    });

    test("Given current + 2 future months are seeded | When we count place_events partitions | Then ≥3 exist", async () => {
      const { data } = await admin.rpc("eval_partition_count", { p_parent: "place_events" });
      expect(data as unknown as number).toBeGreaterThanOrEqual(3);
    });

    test("Given the event_kind enum is locked | When we insert an unknown kind | Then the CHECK rejects it (23514)", async () => {
      // Disambiguate Sacramento city vs county by kind — both share the slug.
      const sacCityId = (
        await admin
          .from("places")
          .select("id")
          .eq("slug", "sacramento")
          .eq("kind", "city")
          .single()
      ).data!.id;
      const { error } = await admin.from("place_events").insert({
        place_id: sacCityId,
        event_kind: "place.unknown",
        payload: {},
      });
      expect(error?.code).toBe("23514");
    });
  });
});
