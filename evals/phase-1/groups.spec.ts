import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Groups spine + 2 children + memberships + events + standing view
// Source of truth:
//   - product/systems/groups.md
//   - planning/adrs/ADR-0013-groups-consolidation.md
//   - planning/adrs/ADR-0010-action-layer-event-log.md
//   - planning/adrs/ADR-0007-action-layer.md
//   - planning/adrs/ADR-0006-agent-assistance.md
// Ticket: development/tickets/T055-groups-schema.md (014_groups.sql)
//
// Eval-writer firewall: no imports from web/src/. DB reads via service-role +
// RPC helpers in web/supabase/test-helpers/.

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

test.describe("Phase 1 — Groups (T055)", () => {
  // ------------------------------------------------------------
  // groups spine
  // ------------------------------------------------------------

  test.describe("T055 — public.groups spine", () => {
    test("Given the migration has applied | When we describe groups | Then the b1 column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "groups" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "name",
          "slug",
          "kind",
          "anchor_location_id",
          "parent_group_id",
          "founder_member_id",
          "description",
          "discoverability",
          "metadata",
          "established_on",
          "dormant_at",
          "dissolves_at",
          "dissolved_at",
          "created_at",
          "updated_at",
        ]),
      );
    });

    test("Given groups exists | When we attempt to insert a row with kind='invalid' | Then the CHECK constraint rejects it", async () => {
      const ownerId = await seedMember("g-kind");

      const { error } = await admin.from("groups").insert({
        kind: "invalid_kind",
        name: "Bad Kind",
        slug: `bad-kind-${ownerId.slice(0, 6)}`,
        founder_member_id: ownerId,
        discoverability: "listed",
      });
      expect(error?.code).toBe("23514");

      await cleanupMember(ownerId);
    });

    test("Given kind='family' is inserted with discoverability unset | When the trigger fires | Then discoverability reads back as 'private'", async () => {
      const ownerId = await seedMember("g-fam");

      const { data, error } = await admin
        .from("groups")
        .insert({
          kind: "family",
          name: "The Smiths",
          slug: `fam-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: null,
        })
        .select("id, discoverability")
        .single();
      expect(error).toBeNull();
      // Why: groups.md absolutes audit (2026-05-19) Absolute 4 — family-kind
      // defaults private; encoded by trg_groups_default_discoverability.
      expect(data?.discoverability).toBe("private");

      await admin.from("groups").delete().eq("id", data!.id);
      await cleanupMember(ownerId);
    });

    test("Given kind='business' is inserted with discoverability unset | When the trigger fires | Then discoverability reads back as 'listed'", async () => {
      const ownerId = await seedMember("g-biz");

      const { data, error } = await admin
        .from("groups")
        .insert({
          kind: "business",
          name: "Oak Park Sourdough",
          slug: `biz-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: null,
        })
        .select("id, discoverability")
        .single();
      expect(error).toBeNull();
      expect(data?.discoverability).toBe("listed");

      await admin.from("groups").delete().eq("id", data!.id);
      await cleanupMember(ownerId);
    });

    test("Given discoverability='private' is explicitly set on a non-family Group | When the trigger sees a non-null value | Then it does NOT overwrite the explicit choice", async () => {
      const ownerId = await seedMember("g-explicit");

      const { data, error } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Private Circle",
          slug: `priv-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "private",
        })
        .select("id, discoverability")
        .single();
      expect(error).toBeNull();
      expect(data?.discoverability).toBe("private");

      await admin.from("groups").delete().eq("id", data!.id);
      await cleanupMember(ownerId);
    });

    test("Given the spine ships kind in (place/interest/practice/event_anchored/family/business) | When we insert one of each | Then all six succeed", async () => {
      const ownerId = await seedMember("g-six");
      const kinds = ["place", "interest", "practice", "event_anchored", "family", "business"];
      const ids: string[] = [];
      for (const k of kinds) {
        const { data, error } = await admin
          .from("groups")
          .insert({
            kind: k,
            name: `K-${k}`,
            slug: `k-${k}-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: "listed",
          })
          .select("id")
          .single();
        expect(error, `kind=${k} rejected`).toBeNull();
        ids.push(data!.id);
      }
      for (const id of ids) {
        await admin.from("groups").delete().eq("id", id);
      }
      await cleanupMember(ownerId);
    });

    test.describe("RLS matrix on public.groups", () => {
      test("Given a listed Group | When anon queries it | Then the row IS returned", async () => {
        const ownerId = await seedMember("g-rls-listed");
        const { data: g } = await admin
          .from("groups")
          .insert({
            kind: "interest",
            name: "Listed Group",
            slug: `rls-listed-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: "listed",
          })
          .select("id")
          .single();

        const { data, error } = await anon.from("groups").select("id").eq("id", g!.id);
        expect(error).toBeNull();
        expect(data?.length).toBe(1);

        await admin.from("groups").delete().eq("id", g!.id);
        await cleanupMember(ownerId);
      });

      test("Given a private Group | When anon queries it | Then RLS returns zero rows", async () => {
        const ownerId = await seedMember("g-rls-priv");
        const { data: g } = await admin
          .from("groups")
          .insert({
            kind: "family",
            name: "Private Family",
            slug: `rls-priv-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: null,
          })
          .select("id")
          .single();

        const { data, error } = await anon.from("groups").select("id").eq("id", g!.id);
        expect(error).toBeNull();
        expect(data?.length).toBe(0);

        await admin.from("groups").delete().eq("id", g!.id);
        await cleanupMember(ownerId);
      });

      test("Given a dissolved listed Group | When anon queries it | Then it is NOT returned (dissolved_at gate)", async () => {
        const ownerId = await seedMember("g-rls-dissolved");
        const { data: g } = await admin
          .from("groups")
          .insert({
            kind: "interest",
            name: "Dissolved Group",
            slug: `rls-dis-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: "listed",
            dissolved_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        const { data } = await anon.from("groups").select("id").eq("id", g!.id);
        expect(data?.length).toBe(0);

        await admin.from("groups").delete().eq("id", g!.id);
        await cleanupMember(ownerId);
      });
    });
  });

  // ------------------------------------------------------------
  // group_businesses
  // ------------------------------------------------------------

  test.describe("T055 — public.group_businesses", () => {
    test("Given group_businesses exists | When we describe it | Then it carries (group_id, display_name, public_description, legal_entity_kind, state_of_formation, formed_at)", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "group_businesses" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "group_id",
          "display_name",
          "public_description",
          "legal_entity_kind",
          "state_of_formation",
          "formed_at",
        ]),
      );
    });

    test("Given a kind='business' Group exists | When we insert its group_businesses row | Then it succeeds", async () => {
      const ownerId = await seedMember("g-biz-child");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "business",
          name: "Maya's Sourdough",
          slug: `biz-child-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();

      const { error } = await admin.from("group_businesses").insert({
        group_id: g!.id,
        display_name: "Maya's Sourdough",
        public_description: "Naturally leavened, from Oak Park",
        legal_entity_kind: "sole_prop",
      });
      expect(error).toBeNull();

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });
  });

  // ------------------------------------------------------------
  // group_event_anchored
  // ------------------------------------------------------------

  test.describe("T055 — public.group_event_anchored", () => {
    test("Given group_event_anchored exists | When we describe it | Then seeded_by_item_id is present (no FK yet — deferred to T056)", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "group_event_anchored" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(["group_id", "seeded_by_item_id"]));
    });
  });

  // ------------------------------------------------------------
  // group_memberships
  // ------------------------------------------------------------

  test.describe("T055 — public.group_memberships", () => {
    test("Given group_memberships exists | When we describe it | Then it carries the composite-PK + source + soft-leave columns", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "group_memberships" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "group_id",
          "member_id",
          "role",
          "source",
          "joined_at",
          "left_at",
          "confirmed_by_member_id",
          "confirmed_at",
        ]),
      );
    });

    test("Given the source CHECK requires explicit / soft_via_follow / soft_via_attendance | When we attempt to insert source='bogus' | Then it is rejected", async () => {
      const ownerId = await seedMember("g-src");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Source CHECK probe",
          slug: `src-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();

      const { error } = await admin.from("group_memberships").insert({
        group_id: g!.id,
        member_id: ownerId,
        role: "member",
        source: "bogus",
      });
      expect(error?.code).toBe("23514");

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });

    test("Given source='soft_via_follow' is permitted in the schema | When we insert one | Then it succeeds (handler enforcement is at Phase 2)", async () => {
      const ownerId = await seedMember("g-soft");
      const memberId = await seedMember("g-soft-m");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "place",
          name: "Soft Probe",
          slug: `soft-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();

      // Why: absolutes audit 2026-05-19 Absolute 2/3 — soft_via_* values are
      // reserved substrate; the schema permits them for symmetry, but no
      // trigger writes them and Phase-2 handlers refuse them for business
      // kind. The eval confirms schema permits.
      const { error } = await admin.from("group_memberships").insert({
        group_id: g!.id,
        member_id: memberId,
        role: "member",
        source: "soft_via_follow",
      });
      expect(error).toBeNull();

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
      await cleanupMember(memberId);
    });

    test.describe("RLS on memberships", () => {
      test("Given a private Group's roster | When anon queries memberships | Then RLS returns zero rows", async () => {
        const ownerId = await seedMember("g-rls-mem-priv");
        const { data: g } = await admin
          .from("groups")
          .insert({
            kind: "family",
            name: "Private Roster",
            slug: `rls-mem-priv-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: null,
          })
          .select("id")
          .single();

        await admin.from("group_memberships").insert({
          group_id: g!.id,
          member_id: ownerId,
          role: "steward",
        });

        const { data } = await anon
          .from("group_memberships")
          .select("group_id, member_id")
          .eq("group_id", g!.id);
        expect(data?.length).toBe(0);

        await admin.from("groups").delete().eq("id", g!.id);
        await cleanupMember(ownerId);
      });

      test("Given a listed Group's explicit active roster | When anon queries memberships | Then RLS returns the row", async () => {
        const ownerId = await seedMember("g-rls-mem-listed");
        const { data: g } = await admin
          .from("groups")
          .insert({
            kind: "interest",
            name: "Listed Roster",
            slug: `rls-mem-listed-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: "listed",
          })
          .select("id")
          .single();

        await admin.from("group_memberships").insert({
          group_id: g!.id,
          member_id: ownerId,
          role: "steward",
          source: "explicit",
        });

        const { data } = await anon
          .from("group_memberships")
          .select("group_id, member_id")
          .eq("group_id", g!.id);
        expect(data?.length).toBe(1);

        await admin.from("groups").delete().eq("id", g!.id);
        await cleanupMember(ownerId);
      });
    });
  });

  // ------------------------------------------------------------
  // group_events
  // ------------------------------------------------------------

  test.describe("T055 — public.group_events (partitioned monthly)", () => {
    test("Given group_events is partitioned | When we ask pg_class | Then relkind='p' (partition parent)", async () => {
      const { data, error } = await admin.rpc("eval_is_partitioned", { p_table: "group_events" });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    test("Given current+2 future months should be seeded | When we count group_events partitions | Then at least 3 exist", async () => {
      const { data, error } = await admin.rpc("eval_partition_count", { p_parent: "group_events" });
      expect(error).toBeNull();
      expect(data as unknown as number).toBeGreaterThanOrEqual(3);
    });

    test("Given the event_kind enum is locked | When we attempt to insert an unknown event_kind | Then the CHECK rejects it", async () => {
      const ownerId = await seedMember("g-evt-bad");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Evt CHECK probe",
          slug: `evt-bad-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();

      const { error } = await admin.from("group_events").insert({
        group_id: g!.id,
        event_kind: "group.unknown",
        acting_member_id: ownerId,
      });
      expect(error?.code).toBe("23514");

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });

    test("Given audit fields are required | When we attempt to insert an event with NULL acting_member_id | Then NOT NULL rejects it", async () => {
      const ownerId = await seedMember("g-evt-audit");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Audit probe",
          slug: `evt-audit-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();

      const { error } = await admin.from("group_events").insert({
        group_id: g!.id,
        event_kind: "group.created",
        acting_member_id: null,
      });
      expect(error?.code).toBe("23502");

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });

    test("Given anon has no group membership | When anon attempts to SELECT group_events | Then RLS returns zero rows", async () => {
      const ownerId = await seedMember("g-evt-rls");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Evt RLS probe",
          slug: `evt-rls-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();

      await admin.from("group_events").insert({
        group_id: g!.id,
        event_kind: "group.created",
        acting_member_id: ownerId,
      });

      const { data } = await anon.from("group_events").select("id").eq("group_id", g!.id);
      expect(data?.length).toBe(0);

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });
  });

  // ------------------------------------------------------------
  // member_has_standing_presence view
  // ------------------------------------------------------------

  test.describe("T055 — public.member_has_standing_presence (view)", () => {
    test("Given a Member with kind='business' owner membership | When we read the view | Then they appear", async () => {
      const ownerId = await seedMember("g-stand-biz");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "business",
          name: "Standing Biz",
          slug: `stand-biz-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();
      await admin.from("group_memberships").insert({
        group_id: g!.id,
        member_id: ownerId,
        role: "owner",
        source: "explicit",
      });

      const { data, error } = await admin
        .from("member_has_standing_presence")
        .select("member_id")
        .eq("member_id", ownerId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });

    test("Given a Member with steward role in a non-business Group | When we read the view | Then they appear", async () => {
      const ownerId = await seedMember("g-stand-stew");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Stewarded Circle",
          slug: `stand-stew-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();
      await admin.from("group_memberships").insert({
        group_id: g!.id,
        member_id: ownerId,
        role: "steward",
        source: "explicit",
      });

      const { data, error } = await admin
        .from("member_has_standing_presence")
        .select("member_id")
        .eq("member_id", ownerId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });

    test("Given a Member with only role='member' in a non-business Group | When we read the view | Then they do NOT appear", async () => {
      const ownerId = await seedMember("g-stand-none");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "interest",
          name: "Plain Member",
          slug: `stand-none-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();
      await admin.from("group_memberships").insert({
        group_id: g!.id,
        member_id: ownerId,
        role: "member",
        source: "explicit",
      });

      const { data, error } = await admin
        .from("member_has_standing_presence")
        .select("member_id")
        .eq("member_id", ownerId);
      expect(error).toBeNull();
      expect(data?.length).toBe(0);

      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });
  });
});

// ------------------------------------------------------------
// Helpers — local to this spec.
// ------------------------------------------------------------

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
  await admin.from("members").delete().eq("id", id);
  try {
    await admin.auth.admin.deleteUser(id);
  } catch {
    // best-effort
  }
}
