import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — discoverable_items materialized view + refresh trigger.
// Source of truth:
//   - product/systems/item.md § "Discoverable-items refresh trigger"
//   - planning/adrs/ADR-0010-action-layer-event-log.md
//   - planning/adrs/ADR-0007-action-layer.md
// Ticket: development/tickets/T057-discoverable-items.md (016_discoverable_items.sql)
//
// Eval-writer firewall: no imports from web/src/. DB reads via service-role +
// RPC helpers in web/supabase/test-helpers/.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const SYSTEM_MEMBER_ID = "00000000-0000-0000-0000-000000000001";

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

test.describe("Phase 1 — discoverable_items (T057)", () => {
  test("Given the view exists | When anon SELECTs from discoverable_items | Then the call succeeds (public-read surface)", async () => {
    const { error } = await anon.from("discoverable_items").select("item_id").limit(1);
    expect(error).toBeNull();
  });

  test("Given the unique index exists | When we list indexes on discoverable_items | Then unique_idx_discoverable_items is present and UNIQUE", async () => {
    const { data, error } = await admin.rpc("eval_indexes_for_table", { p_table: "discoverable_items" });
    expect(error).toBeNull();
    const idx = (data as Array<{ indexname: string; indexdef: string }>).find(
      (i) => i.indexname === "unique_idx_discoverable_items",
    );
    expect(idx).toBeTruthy();
    // Why: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index;
    // the indexdef confirms the UNIQUE marker is in place.
    expect(idx?.indexdef).toMatch(/CREATE UNIQUE INDEX/);
  });

  test("Given an Item exists in state='draft' | When we query the view | Then the Item is NOT present", async () => {
    const ownerId = await seedMember("di-draft");
    const { data: it } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "product", title: "Draft only" })
      .select("id")
      .single();
    // No item.published event fired; view unaffected. Force a refresh to be sure.
    await forceRefresh(ownerId);
    const { data } = await admin.from("discoverable_items").select("item_id").eq("item_id", it!.id);
    expect(data?.length).toBe(0);
    await admin.from("items").delete().eq("id", it!.id);
    await cleanupMember(ownerId);
  });

  test("Given a published standalone Item | When item.published fires | Then it appears in the view", async () => {
    const ownerId = await seedMember("di-pub");
    const { data: it } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "product", title: "Published", state: "published" })
      .select("id")
      .single();
    // Trigger refresh by inserting item.published event.
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    const { data } = await admin.from("discoverable_items").select("item_id, item_kind, title").eq("item_id", it!.id);
    expect(data?.length).toBe(1);
    expect(data?.[0].title).toBe("Published");
    await admin.from("items").delete().eq("id", it!.id);
    await cleanupMember(ownerId);
  });

  test("Given a published Item filed under a listed Group | When the publish event fires | Then it appears in the view with group context", async () => {
    const ownerId = await seedMember("di-grp-listed");
    const { data: g } = await admin
      .from("groups")
      .insert({
        kind: "business",
        name: "Listed Biz",
        slug: `di-listed-${ownerId.slice(0, 6)}`,
        founder_member_id: ownerId,
        discoverability: "listed",
      })
      .select("id")
      .single();
    await admin.from("group_businesses").insert({
      group_id: g!.id,
      display_name: "Listed Biz Display",
      public_description: "",
    });
    const { data: it } = await admin
      .from("items")
      .insert({
        member_id: ownerId,
        kind: "product",
        title: "In a listed group",
        state: "published",
        group_id: g!.id,
      })
      .select("id")
      .single();
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    const { data } = await admin
      .from("discoverable_items")
      .select("item_id, group_id, group_business_display_name")
      .eq("item_id", it!.id);
    expect(data?.length).toBe(1);
    expect(data?.[0].group_id).toBe(g!.id);
    expect(data?.[0].group_business_display_name).toBe("Listed Biz Display");
    await admin.from("items").delete().eq("id", it!.id);
    await admin.from("groups").delete().eq("id", g!.id);
    await cleanupMember(ownerId);
  });

  test("Given a published Item filed under a private (family) Group | When the publish event fires | Then it is NOT in the view (group filter)", async () => {
    const ownerId = await seedMember("di-grp-priv");
    const { data: g } = await admin
      .from("groups")
      .insert({
        kind: "family",
        name: "Private fam",
        slug: `di-priv-${ownerId.slice(0, 6)}`,
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
        title: "In a family group",
        state: "published",
        group_id: g!.id,
      })
      .select("id")
      .single();
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    const { data } = await admin.from("discoverable_items").select("item_id").eq("item_id", it!.id);
    expect(data?.length).toBe(0);
    await admin.from("items").delete().eq("id", it!.id);
    await admin.from("groups").delete().eq("id", g!.id);
    await cleanupMember(ownerId);
  });

  test("Given a published Item is soft-deleted | When a subsequent publish event refreshes the view | Then the soft-deleted Item is gone", async () => {
    const ownerId = await seedMember("di-soft");
    const { data: a } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "product", title: "Will be deleted", state: "published" })
      .select("id")
      .single();
    await admin.from("item_events").insert({
      item_id: a!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    // Confirm present.
    const { data: presence } = await admin.from("discoverable_items").select("item_id").eq("item_id", a!.id);
    expect(presence?.length).toBe(1);
    // Soft-delete. (Soft-delete doesn't fire item.published — by design.)
    await admin.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", a!.id);
    // Insert a second Item + publish event to force refresh.
    const { data: b } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "product", title: "Forces refresh", state: "published" })
      .select("id")
      .single();
    await admin.from("item_events").insert({
      item_id: b!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    // Soft-deleted Item gone.
    const { data: gone } = await admin.from("discoverable_items").select("item_id").eq("item_id", a!.id);
    expect(gone?.length).toBe(0);
    // Second Item present.
    const { data: present } = await admin.from("discoverable_items").select("item_id").eq("item_id", b!.id);
    expect(present?.length).toBe(1);

    await admin.from("items").delete().eq("id", a!.id);
    await admin.from("items").delete().eq("id", b!.id);
    await cleanupMember(ownerId);
  });

  test("Given event_kind != 'item.published' | When we insert that event | Then the view is NOT refreshed", async () => {
    const ownerId = await seedMember("di-other");
    // Create a published Item but DO NOT fire item.published yet.
    const { data: it } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "product", title: "Pre-publish", state: "published" })
      .select("id")
      .single();
    // View shouldn't have it yet.
    const { data: before } = await admin.from("discoverable_items").select("item_id").eq("item_id", it!.id);
    expect(before?.length).toBe(0);
    // Insert a NON-publish event — view must remain unchanged.
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.updated",
      acting_member_id: ownerId,
    });
    const { data: after } = await admin.from("discoverable_items").select("item_id").eq("item_id", it!.id);
    expect(after?.length).toBe(0);
    // Confirm publish event DOES refresh.
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    const { data: post } = await admin.from("discoverable_items").select("item_id").eq("item_id", it!.id);
    expect(post?.length).toBe(1);

    await admin.from("items").delete().eq("id", it!.id);
    await cleanupMember(ownerId);
  });

  test("Given a published Item has multiple item_locations | When the publish event fires | Then nearest_location_id is the earliest-attached, approved row", async () => {
    const ownerId = await seedMember("di-loc");
    const { data: it } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "gathering", title: "Multi-loc", state: "published" })
      .select("id")
      .single();
    const { data: locA } = await admin
      .from("locations")
      .insert({
        member_id: ownerId,
        kind: "permanent",
        label: "First",
        slug: `di-first-${ownerId.slice(0, 6)}`,
        geography: "POINT(-121.5 38.6)",
      })
      .select("id")
      .single();
    const { data: locB } = await admin
      .from("locations")
      .insert({
        member_id: ownerId,
        kind: "permanent",
        label: "Second",
        slug: `di-second-${ownerId.slice(0, 6)}`,
        geography: "POINT(-122.0 37.5)",
      })
      .select("id")
      .single();
    await admin.from("item_locations").insert({
      item_id: it!.id,
      location_id: locA!.id,
      schedule_kind: "recurring",
      status: "approved",
    });
    // Insert second attachment ~1s later so created_at orders deterministically.
    await new Promise((r) => setTimeout(r, 50));
    await admin.from("item_locations").insert({
      item_id: it!.id,
      location_id: locB!.id,
      schedule_kind: "one_time",
      status: "approved",
    });
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    const { data } = await admin
      .from("discoverable_items")
      .select("nearest_location_id")
      .eq("item_id", it!.id);
    expect(data?.[0].nearest_location_id).toBe(locA!.id);

    await admin.from("items").delete().eq("id", it!.id);
    await admin.from("locations").delete().eq("id", locA!.id);
    await admin.from("locations").delete().eq("id", locB!.id);
    await cleanupMember(ownerId);
  });

  test("Given a published Item has multiple responses | When the publish event fires | Then response_count reflects active rows only", async () => {
    const ownerId = await seedMember("di-resp");
    const responder = await seedMember("di-r");
    const { data: it } = await admin
      .from("items")
      .insert({ member_id: ownerId, kind: "wonder", title: "Resp count", state: "published" })
      .select("id")
      .single();
    // Two active responses, one withdrawn.
    await admin.from("item_responses").insert({
      item_id: it!.id,
      responder_member_id: responder,
      response_kind: "interest",
    });
    await admin.from("item_responses").insert({
      item_id: it!.id,
      responder_member_id: ownerId,
      response_kind: "interest",
    });
    await admin.from("item_responses").insert({
      item_id: it!.id,
      responder_member_id: responder,
      response_kind: "save",
      withdrawn_at: new Date().toISOString(),
    });
    await admin.from("item_events").insert({
      item_id: it!.id,
      event_kind: "item.published",
      acting_member_id: ownerId,
    });
    const { data } = await admin.from("discoverable_items").select("response_count").eq("item_id", it!.id);
    expect(data?.[0].response_count).toBe(2);

    await admin.from("items").delete().eq("id", it!.id);
    await cleanupMember(ownerId);
    await cleanupMember(responder);
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

// Force the materialized view to refresh by inserting a throwaway publish
// event under the system Member. Used when a test needs the view to reflect
// state changes that didn't themselves fire item.published.
async function forceRefresh(actingMemberId: string): Promise<void> {
  const { data: dummy } = await admin
    .from("items")
    .insert({ member_id: actingMemberId, kind: "product", title: "Refresh trigger", state: "published" })
    .select("id")
    .single();
  if (!dummy) return;
  await admin.from("item_events").insert({
    item_id: dummy.id,
    event_kind: "item.published",
    acting_member_id: actingMemberId,
  });
  await admin.from("items").delete().eq("id", dummy.id);
}
