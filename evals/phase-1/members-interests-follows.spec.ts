import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Member interests + member follows
// Source of truth:
//   - notes/migration-to-primitives.md § Phase 1 — Member surface
//   - product/systems/member.md lines 230 (interests) + 243 (follows)
//   - planning/DECISIONS.md ADR-9 (policy framework — softened follow posture
//     2026-05-11: follow graph is community-fabric, not gated by privacy)
//   - planning/DECISIONS.md ADR-7 (action-layer-only writes)
// Ticket: T048 — Member interests + follows (010_member_interests_follows.sql).

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let admin: SupabaseClient;
let anon: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_ANON_KEY ? SUPABASE_URL : SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

test.describe("Phase 1 — Member interests + follows (T048)", () => {
  // ------------------------------------------------------------
  // T048 — public.member_interests
  // ------------------------------------------------------------

  test.describe("T048 — public.member_interests", () => {
    test("Given the migration has applied | When we describe member_interests | Then (member_id, tag, created_at) are present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_interests" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(["member_id", "tag", "created_at"]));
    });

    test("Given the tag CHECK constraint exists | When we attempt to insert a tag with uppercase chars | Then the CHECK rejects it", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `int-${memberId.slice(0, 6)}`, display_name: "Interest Probe" });

      // Why: member.md / T048 — the lowercase-alnum-hyphen tag shape lets
      // the action handler trust raw values for downstream embedding /
      // hashtag rendering. Uppercase or special chars are rejected at the
      // schema floor as defense-in-depth even though the handler also
      // validates.
      const { error } = await admin.from("member_interests").insert({ member_id: memberId, tag: "Live-Music" });
      expect(error?.code).toBe("23514");

      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given inverse-lookup queries depend on idx_member_interests_tag | When we list indexes | Then it exists", async () => {
      const { data, error } = await admin.rpc("eval_indexes_for_table", { p_table: "member_interests" });
      expect(error).toBeNull();
      const names = (data as Array<{ indexname: string }>).map((r) => r.indexname);
      // Why: T048 — the inverse lookup ("which Members declare interest in
      // `live-music`?") powers Group suggestion at onboarding and locality-
      // index relevance scoring. Missing this index would silently degrade
      // those reads to a full scan as the table grows.
      expect(names).toEqual(expect.arrayContaining(["idx_member_interests_tag"]));
    });

    test("Given interests are public-by-default | When anon queries the table | Then RLS allows read (no rows yet → empty array)", async () => {
      // Why: T048 — interests power Item relevance and Group suggestion.
      // Public visibility is a deliberate design choice (member_interests
      // != member_follows): interests are taste profile; follow graph is
      // social graph; only the latter could benefit from privacy gating,
      // and per the 2026-05-11 product re-scope even that doesn't gate.
      const { data, error } = await anon.from("member_interests").select("tag").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // ------------------------------------------------------------
  // T048 — public.member_follows
  // ------------------------------------------------------------

  test.describe("T048 — public.member_follows", () => {
    test("Given the migration has applied | When we describe member_follows | Then composite-PK + soft-unfollow columns are present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_follows" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining(["follower_member_id", "followed_member_id", "created_at", "unfollowed_at"]),
      );
    });

    test("Given the self-follow CHECK exists | When we attempt to insert (A, A) | Then the CHECK rejects it", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `sf-${memberId.slice(0, 6)}`, display_name: "Self Follow Probe" });

      // Why: A self-follow is a meaningless edge that would corrupt the
      // follow graph's directionality. The schema floor blocks it.
      const { error } = await admin
        .from("member_follows")
        .insert({ follower_member_id: memberId, followed_member_id: memberId });
      expect(error?.code).toBe("23514");

      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the two follower-direction surfaces depend on partial indexes | When we list indexes | Then both active-follow partials exist", async () => {
      const { data, error } = await admin.rpc("eval_indexes_for_table", { p_table: "member_follows" });
      expect(error).toBeNull();
      const idx = data as Array<{ indexname: string; indexdef: string }>;
      const followed = idx.find((r) => r.indexname === "idx_follows_followed_active");
      const follower = idx.find((r) => r.indexname === "idx_follows_follower_active");
      // Why: T048 — both surfaces ("who follows X" + "who does X follow")
      // filter `where unfollowed_at is null`. Partial indexes keep the hot
      // path lean as soft-unfollow rows accumulate. Asserting both presence
      // and the `where unfollowed_at is null` predicate prevents a regression
      // where the predicate is dropped, ballooning index size.
      expect(followed?.indexdef).toMatch(/where \(unfollowed_at is null\)/i);
      expect(follower?.indexdef).toMatch(/where \(unfollowed_at is null\)/i);
    });

    test("Given follow visibility is public-by-default (2026-05-11 re-scope) | When anon queries member_follows | Then RLS allows read", async () => {
      // Why: T048 DEVIATIONS / 2026-05-11 product decision — follow graph is
      // community-fabric; the load-bearing privacy work shifted to
      // member_place_interests (T062, owner-only RLS per ADR-21;
      // member_location_affinities itself retired by T061). member_follows
      // policy is `using (true)`. The reserved member_privacy.show_following
      // columns stay as substrate for a possible b2 per-Member opt-out.
      const { data, error } = await anon.from("member_follows").select("follower_member_id").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test("Given anon has no auth.uid() | When anon attempts INSERT into member_follows | Then it is rejected (no insert policy)", async () => {
      // Why: ADR-7 — follow writes flow through member.follow / unfollow
      // handlers which set unfollowed_at appropriately and emit the
      // corresponding member_events rows in the same transaction. Direct
      // anon insert must fail.
      const { error } = await anon
        .from("member_follows")
        .insert({ follower_member_id: randomUUID(), followed_member_id: randomUUID() });
      expect(error, "anon insert into member_follows must fail").not.toBeNull();
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
