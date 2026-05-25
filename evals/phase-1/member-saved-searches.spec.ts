import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Member saved searches (T063).
//
// Source of truth:
//   - product/systems/member.md § Saved searches
//   - planning/adrs/ADR-0021-member-geography-substrate-split.md (Ratified 2026-05-23)
//   - planning/bundles/b1x-substrate-sprint.md § B3
//   - web/supabase/migrations/019_member_saved_searches.sql
//
// Encoded absolutes verified here:
//   - owner-only RLS at row level (ADR-21)
//   - at_least_one_filter CHECK (member.md § Saved searches Intent)
//   - action-layer-only writes
//   - label length CHECK (1-80)

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
  await admin.from("member_saved_searches").delete().eq("member_id", id);
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

test.describe("Phase 1 — Member saved searches (T063)", () => {
  test.describe("T063 — public.member_saved_searches schema shape", () => {
    test("Given the migration has applied | When we describe member_saved_searches | Then the b1 column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", {
        p_table: "member_saved_searches",
      });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "member_id",
          "label",
          "place_id",
          "location_id",
          "interest_tags",
          "item_kinds",
          "created_at",
          "updated_at",
          "removed_at",
        ]),
      );
    });
  });

  test.describe("T063 — at_least_one_filter CHECK (the load-bearing invariant)", () => {
    test("Given no filters set | When we insert with NULL place + NULL location + empty interest_tags | Then the CHECK rejects it (23514)", async () => {
      // Encodes member.md § Saved searches absolute — a no-filter saved
      // search would fan out to every Item. The DB CHECK is the load-
      // bearing copy; the Zod refinement in the action handler is the
      // fast-feedback copy.
      const memberId = await seedMember("mss-empty");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "Empty wildcard",
        // place_id, location_id default NULL; interest_tags defaults '{}'
      });
      expect(error?.code).toBe("23514");
      expect(error?.message).toMatch(/at_least_one_filter/i);
      await cleanupMember(memberId);
    });

    test("Given a place_id is set | When we insert | Then it succeeds", async () => {
      const memberId = await seedMember("mss-place");
      // Use 'oak-park' (unambiguous neighborhood slug). 'sacramento' is
      // shared by the county and the city per ADR-0022 — .single() would
      // error.
      const oakPark = await getSeededPlace("oak-park");
      const { data, error } = await admin
        .from("member_saved_searches")
        .insert({
          member_id: memberId,
          label: "Near Oak Park",
          place_id: oakPark,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      await cleanupMember(memberId);
    });

    test("Given only interest_tags is set (non-empty) | When we insert | Then it succeeds", async () => {
      const memberId = await seedMember("mss-tags");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "Organic anywhere",
        interest_tags: ["organic"],
      });
      expect(error).toBeNull();
      await cleanupMember(memberId);
    });

    test("Given only item_kinds is set (interest_tags empty) | When we insert | Then the CHECK rejects it (item_kinds alone is too broad)", async () => {
      // Why: item_kinds alone would still fan out to every published row of
      // that kind across the platform. The CHECK predicate intentionally
      // does NOT include array_length(item_kinds, 1) — item_kinds is a
      // refinement filter, not a primary filter.
      const memberId = await seedMember("mss-kinds");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "All products everywhere",
        item_kinds: ["product"],
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(memberId);
    });
  });

  test.describe("T063 — label length CHECK", () => {
    test("Given the label length CHECK | When we insert label='' | Then the CHECK rejects it", async () => {
      const memberId = await seedMember("mss-lbl0");
      const oak = await getSeededPlace("oak-park");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "",
        place_id: oak,
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(memberId);
    });

    test("Given the label length CHECK | When we insert label of 81 chars | Then the CHECK rejects it", async () => {
      const memberId = await seedMember("mss-lbl81");
      const oak = await getSeededPlace("oak-park");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "x".repeat(81),
        place_id: oak,
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(memberId);
    });

    test("Given the boundary | When we insert label of 80 chars | Then it succeeds", async () => {
      const memberId = await seedMember("mss-lbl80");
      const oak = await getSeededPlace("oak-park");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "x".repeat(80),
        place_id: oak,
      });
      expect(error).toBeNull();
      await cleanupMember(memberId);
    });
  });

  test.describe("T063 — RLS matrix (owner-only — ADR-21)", () => {
    test("Given Member A has a saved search | When anon queries member_saved_searches | Then RLS returns zero rows", async () => {
      const memberId = await seedMember("mss-rls");
      const oak = await getSeededPlace("oak-park");
      await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "Oak Park products",
        place_id: oak,
        item_kinds: ["product"],
      });

      const { data, error } = await anon
        .from("member_saved_searches")
        .select("id")
        .eq("member_id", memberId);
      expect(error).toBeNull();
      expect(data?.length).toBe(0);

      await cleanupMember(memberId);
    });

    test("Given anon has no auth.uid() | When anon attempts INSERT | Then it is rejected (no insert policy)", async () => {
      const oak = await getSeededPlace("oak-park");
      const { error } = await anon.from("member_saved_searches").insert({
        member_id: randomUUID(),
        label: "Anon should not be able to do this",
        place_id: oak,
      });
      expect(error).not.toBeNull();
    });
  });

  test.describe("T063 — FK behaviour", () => {
    test("Given a non-existent place_id | When we insert | Then 23503 fires", async () => {
      const memberId = await seedMember("mss-fk-p");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "Bogus place",
        place_id: randomUUID(),
      });
      expect(error?.code).toBe("23503");
      await cleanupMember(memberId);
    });

    test("Given a non-existent location_id | When we insert | Then 23503 fires", async () => {
      const memberId = await seedMember("mss-fk-l");
      const { error } = await admin.from("member_saved_searches").insert({
        member_id: memberId,
        label: "Bogus location",
        location_id: randomUUID(),
      });
      expect(error?.code).toBe("23503");
      await cleanupMember(memberId);
    });
  });

  test.describe("T063 — updated_at trigger", () => {
    test("Given an existing row | When we update label | Then updated_at advances", async () => {
      const memberId = await seedMember("mss-upd");
      const oak = await getSeededPlace("oak-park");
      const { data: ins } = await admin
        .from("member_saved_searches")
        .insert({ member_id: memberId, label: "Initial", place_id: oak })
        .select("id, updated_at")
        .single();

      // Brief delay so the new timestamp is observably different.
      await new Promise((r) => setTimeout(r, 25));

      const { data: upd } = await admin
        .from("member_saved_searches")
        .update({ label: "Renamed" })
        .eq("id", ins!.id)
        .select("updated_at")
        .single();

      expect(new Date(upd!.updated_at).getTime()).toBeGreaterThan(
        new Date(ins!.updated_at).getTime(),
      );

      await cleanupMember(memberId);
    });
  });
});
