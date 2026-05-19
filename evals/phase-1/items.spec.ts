import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Items spine + 4 kind children + 4 join tables + events.
// Source of truth:
//   - product/systems/item.md
//   - planning/adrs/ADR-0005-markets-as-gathering-items.md
//   - planning/adrs/ADR-0010-action-layer-event-log.md
//   - planning/adrs/ADR-0007-action-layer.md
//   - planning/adrs/ADR-0006-agent-assistance.md
// Ticket: development/tickets/T056-items-schema.md (015_items.sql)
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

test.describe("Phase 1 — Items (T056)", () => {
  // ------------------------------------------------------------
  // Spine
  // ------------------------------------------------------------

  test.describe("T056 — public.items spine", () => {
    test("Given the migration has applied | When we describe items | Then the b1 column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "items" });
      expect(error).toBeNull();
      const cols = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "member_id",
          "kind",
          "group_id",
          "title",
          "description",
          "state",
          "category",
          "brand_label",
          "qr_card_url",
          "ambient_extras",
          "parent_item_id",
          "collection_id",
          "federation_origin",
          "embedding_id",
          "created_at",
          "updated_at",
          "fulfilled_at",
          "deleted_at",
        ]),
      );
    });

    test("Given kind enum is locked at 7 values | When we attempt to insert kind='invalid' | Then the CHECK rejects it", async () => {
      const ownerId = await seedMember("it-kind");
      const { error } = await admin.from("items").insert({
        member_id: ownerId,
        kind: "invalid_kind",
        title: "Bad",
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(ownerId);
    });

    test("Given kind reserves offer/ask/initiative | When we insert one of each | Then the spine accepts them (substrate only at b1)", async () => {
      const ownerId = await seedMember("it-reserved");
      const ids: string[] = [];
      for (const k of ["offer", "ask", "initiative"]) {
        const { data, error } = await admin
          .from("items")
          .insert({ member_id: ownerId, kind: k, title: `Reserved ${k}` })
          .select("id")
          .single();
        expect(error, `kind=${k} rejected`).toBeNull();
        ids.push(data!.id);
      }
      for (const id of ids) await admin.from("items").delete().eq("id", id);
      await cleanupMember(ownerId);
    });

    test("Given state enum is locked | When we attempt to insert state='active' | Then the CHECK rejects it (active was dropped 2026-05-19)", async () => {
      const ownerId = await seedMember("it-state-active");
      // Why: T056 reconciled the state enum to (draft/published/withdrawn/
      // fulfilled/closed). 'active' is dropped; the lifecycle target for
      // visible Items is 'published'.
      const { error } = await admin.from("items").insert({
        member_id: ownerId,
        kind: "product",
        title: "State probe",
        state: "active",
      });
      expect(error?.code).toBe("23514");
      await cleanupMember(ownerId);
    });

    test("Given state defaults | When we insert with state unset | Then state reads back as 'draft'", async () => {
      const ownerId = await seedMember("it-default");
      const { data, error } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "Default state" })
        .select("id, state")
        .single();
      expect(error).toBeNull();
      expect(data?.state).toBe("draft");
      await admin.from("items").delete().eq("id", data!.id);
      await cleanupMember(ownerId);
    });

    test.describe("RLS matrix on public.items", () => {
      test("Given a published Item with no group | When anon queries | Then the row IS returned", async () => {
        const ownerId = await seedMember("it-rls-pub");
        const { data } = await admin
          .from("items")
          .insert({ member_id: ownerId, kind: "product", title: "Pub", state: "published" })
          .select("id")
          .single();
        const { data: rows } = await anon.from("items").select("id").eq("id", data!.id);
        expect(rows?.length).toBe(1);
        await admin.from("items").delete().eq("id", data!.id);
        await cleanupMember(ownerId);
      });

      test("Given a draft Item | When anon queries | Then RLS returns zero rows", async () => {
        const ownerId = await seedMember("it-rls-draft");
        const { data } = await admin
          .from("items")
          .insert({ member_id: ownerId, kind: "product", title: "Draft" })
          .select("id")
          .single();
        const { data: rows } = await anon.from("items").select("id").eq("id", data!.id);
        expect(rows?.length).toBe(0);
        await admin.from("items").delete().eq("id", data!.id);
        await cleanupMember(ownerId);
      });

      test("Given a soft-deleted published Item | When anon queries | Then it is NOT returned", async () => {
        const ownerId = await seedMember("it-rls-soft");
        const { data } = await admin
          .from("items")
          .insert({
            member_id: ownerId,
            kind: "product",
            title: "Soft",
            state: "published",
            deleted_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        const { data: rows } = await anon.from("items").select("id").eq("id", data!.id);
        expect(rows?.length).toBe(0);
        await admin.from("items").delete().eq("id", data!.id);
        await cleanupMember(ownerId);
      });

      test("Given a withdrawn Item | When anon queries | Then it is NOT returned (lifecycle gate)", async () => {
        const ownerId = await seedMember("it-rls-with");
        const { data } = await admin
          .from("items")
          .insert({ member_id: ownerId, kind: "product", title: "Withdrawn", state: "withdrawn" })
          .select("id")
          .single();
        const { data: rows } = await anon.from("items").select("id").eq("id", data!.id);
        expect(rows?.length).toBe(0);
        await admin.from("items").delete().eq("id", data!.id);
        await cleanupMember(ownerId);
      });

      test("Given a published Item filed under a private Group | When anon queries | Then RLS does NOT return it", async () => {
        const ownerId = await seedMember("it-rls-priv-grp");
        const { data: g } = await admin
          .from("groups")
          .insert({
            kind: "family",
            name: "Private",
            slug: `priv-it-${ownerId.slice(0, 6)}`,
            founder_member_id: ownerId,
            discoverability: null,
          })
          .select("id")
          .single();
        const { data: it } = await admin
          .from("items")
          .insert({
            member_id: ownerId,
            kind: "product",
            title: "Private group item",
            state: "published",
            group_id: g!.id,
          })
          .select("id")
          .single();
        const { data: rows } = await anon.from("items").select("id").eq("id", it!.id);
        expect(rows?.length).toBe(0);
        await admin.from("items").delete().eq("id", it!.id);
        await admin.from("groups").delete().eq("id", g!.id);
        await cleanupMember(ownerId);
      });
    });
  });

  // ------------------------------------------------------------
  // Kind-specific children
  // ------------------------------------------------------------

  test.describe("T056 — kind-specific children", () => {
    test("Given item_products exists | When we describe it | Then it carries (item_id, price_cents, price_unit, composition, photo_urls, available_until)", async () => {
      const { data } = await admin.rpc("eval_table_shape", { p_table: "item_products" });
      const cols = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(cols).toEqual(
        expect.arrayContaining(["item_id", "price_cents", "price_unit", "composition", "photo_urls", "available_until"]),
      );
    });

    test("Given item_services exists | When we describe it | Then it carries service_area_geography of geography type", async () => {
      const { data } = await admin.rpc("eval_table_shape", { p_table: "item_services" });
      const cols = data as Array<{ column_name: string; data_type: string }>;
      const sag = cols.find((c) => c.column_name === "service_area_geography");
      expect(sag?.data_type).toMatch(/geography/);
    });

    test("Given item_services.rate_model is locked | When we insert rate_model='bogus' | Then the CHECK rejects it", async () => {
      const ownerId = await seedMember("it-svc-rate");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "service", title: "S" })
        .select("id")
        .single();
      const { error } = await admin.from("item_services").insert({ item_id: it!.id, rate_model: "bogus" });
      expect(error?.code).toBe("23514");
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
    });

    test("Given item_gatherings exists | When we describe it | Then it carries (starts_at, recurrence_rule, capacity, host_member_id)", async () => {
      const { data } = await admin.rpc("eval_table_shape", { p_table: "item_gatherings" });
      const cols = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(cols).toEqual(expect.arrayContaining(["item_id", "starts_at", "ends_at", "recurrence_rule", "capacity", "cost_cents", "what_to_bring", "host_member_id", "rsvp_cutoff"]));
    });

    test("Given item_wonders is inserted | When we read expires_at | Then it defaults to ~90 days from now", async () => {
      const ownerId = await seedMember("it-wonder-exp");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "wonder", title: "W" })
        .select("id")
        .single();
      const { data: w } = await admin
        .from("item_wonders")
        .insert({ item_id: it!.id })
        .select("expires_at")
        .single();
      const expires = new Date(w!.expires_at).getTime();
      const now = Date.now();
      const days = (expires - now) / (1000 * 60 * 60 * 24);
      // Tolerance: anywhere between 89.5 and 90.5 days from "now"
      expect(days).toBeGreaterThan(89.5);
      expect(days).toBeLessThan(90.5);
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
    });
  });

  // ------------------------------------------------------------
  // Join tables
  // ------------------------------------------------------------

  test.describe("T056 — join tables", () => {
    test("Given item_locations.schedule_kind is locked | When we insert schedule_kind='bogus' | Then the CHECK rejects it", async () => {
      const ownerId = await seedMember("il-sk");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "L" })
        .select("id")
        .single();
      const { data: loc } = await admin
        .from("locations")
        .insert({
          member_id: ownerId,
          kind: "permanent",
          label: "L",
          slug: `il-${ownerId.slice(0, 6)}`,
          geography: "POINT(-121.5 38.6)",
        })
        .select("id")
        .single();
      const { error } = await admin.from("item_locations").insert({
        item_id: it!.id,
        location_id: loc!.id,
        schedule_kind: "bogus",
      });
      expect(error?.code).toBe("23514");
      await admin.from("locations").delete().eq("id", loc!.id);
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
    });

    test("Given item_responses.response_kind is locked | When we insert response_kind='bogus' | Then the CHECK rejects it", async () => {
      const ownerId = await seedMember("ir-rk");
      const responderId = await seedMember("ir-r");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "R", state: "published" })
        .select("id")
        .single();
      const { error } = await admin.from("item_responses").insert({
        item_id: it!.id,
        responder_member_id: responderId,
        response_kind: "bogus",
      });
      expect(error?.code).toBe("23514");
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
      await cleanupMember(responderId);
    });

    test("Given item_responses.response_kind accepts seven values | When we insert each | Then all succeed", async () => {
      const ownerId = await seedMember("ir-all");
      const responderId = await seedMember("ir-a");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "Resp All", state: "published" })
        .select("id")
        .single();
      const kinds = ["interest", "rsvp", "follow", "save", "pledge", "purchase", "support"];
      for (const k of kinds) {
        const { error } = await admin.from("item_responses").insert({
          item_id: it!.id,
          responder_member_id: responderId,
          response_kind: k,
        });
        expect(error, `response_kind=${k}`).toBeNull();
      }
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
      await cleanupMember(responderId);
    });

    test("Given item_tags exists | When we describe it | Then it carries (item_id, tag) composite PK", async () => {
      const { data } = await admin.rpc("eval_table_shape", { p_table: "item_tags" });
      const cols = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(cols).toEqual(expect.arrayContaining(["item_id", "tag"]));
    });

    test("Given item_hashtags exists | When we describe it | Then it carries (item_id, hashtag, created_at)", async () => {
      const { data } = await admin.rpc("eval_table_shape", { p_table: "item_hashtags" });
      const cols = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(cols).toEqual(expect.arrayContaining(["item_id", "hashtag", "created_at"]));
    });
  });

  // ------------------------------------------------------------
  // Events
  // ------------------------------------------------------------

  test.describe("T056 — public.item_events (partitioned)", () => {
    test("Given item_events is partitioned | When we ask | Then relkind='p'", async () => {
      const { data } = await admin.rpc("eval_is_partitioned", { p_table: "item_events" });
      expect(data).toBe(true);
    });

    test("Given current+2 future months | When we count partitions | Then ≥3 exist", async () => {
      const { data } = await admin.rpc("eval_partition_count", { p_parent: "item_events" });
      expect(data as unknown as number).toBeGreaterThanOrEqual(3);
    });

    test("Given the event_kind enum is locked | When we insert an unknown event_kind | Then the CHECK rejects it", async () => {
      const ownerId = await seedMember("ie-evt");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "E" })
        .select("id")
        .single();
      const { error } = await admin.from("item_events").insert({
        item_id: it!.id,
        event_kind: "item.unknown",
        acting_member_id: ownerId,
      });
      expect(error?.code).toBe("23514");
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
    });

    test("Given audit fields are required | When we insert with NULL acting_member_id | Then NOT NULL rejects it", async () => {
      const ownerId = await seedMember("ie-audit");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "A" })
        .select("id")
        .single();
      const { error } = await admin.from("item_events").insert({
        item_id: it!.id,
        event_kind: "item.created",
        acting_member_id: null,
      });
      expect(error?.code).toBe("23502");
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
    });

    test("Given anon has no membership | When anon queries item_events | Then RLS returns zero rows", async () => {
      const ownerId = await seedMember("ie-rls");
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "product", title: "RLS" })
        .select("id")
        .single();
      await admin.from("item_events").insert({
        item_id: it!.id,
        event_kind: "item.created",
        acting_member_id: ownerId,
      });
      const { data: rows } = await anon.from("item_events").select("id").eq("item_id", it!.id);
      expect(rows?.length).toBe(0);
      await admin.from("items").delete().eq("id", it!.id);
      await cleanupMember(ownerId);
    });
  });

  // ------------------------------------------------------------
  // Deferred FK closure from T055
  // ------------------------------------------------------------

  test.describe("T056 — closes T055's deferred FK", () => {
    test("Given group_event_anchored.seeded_by_item_id now FKs items | When we point at a real Item | Then insert succeeds", async () => {
      const ownerId = await seedMember("ge-real");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "event_anchored",
          name: "EvtA",
          slug: `evta-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();
      const { data: it } = await admin
        .from("items")
        .insert({ member_id: ownerId, kind: "gathering", title: "Seed gathering" })
        .select("id")
        .single();
      const { error } = await admin.from("group_event_anchored").insert({
        group_id: g!.id,
        seeded_by_item_id: it!.id,
      });
      expect(error).toBeNull();
      await admin.from("items").delete().eq("id", it!.id);
      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });

    test("Given group_event_anchored.seeded_by_item_id now FKs items | When we point at a nonexistent UUID | Then insert is rejected with 23503", async () => {
      const ownerId = await seedMember("ge-bad");
      const { data: g } = await admin
        .from("groups")
        .insert({
          kind: "event_anchored",
          name: "EvtB",
          slug: `evtb-${ownerId.slice(0, 6)}`,
          founder_member_id: ownerId,
          discoverability: "listed",
        })
        .select("id")
        .single();
      const { error } = await admin.from("group_event_anchored").insert({
        group_id: g!.id,
        seeded_by_item_id: randomUUID(),
      });
      expect(error?.code).toBe("23503");
      await admin.from("groups").delete().eq("id", g!.id);
      await cleanupMember(ownerId);
    });
  });
});

// ------------------------------------------------------------
// Helpers
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
