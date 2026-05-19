import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Locations spine + 3 children + events + RLS fix-forward
// Source of truth:
//   - notes/migration-to-primitives.md § Phase 1 — Location surface (008 series
//     in the plan; renumbered to 007/008 in the build per T045 DEVIATIONS)
//   - product/systems/location.md (spec banner ratifies ADR-14)
//   - planning/DECISIONS.md ADR-14 (Location spine + child architecture)
//   - planning/DECISIONS.md ADR-10 → ADR-7 (action layer + atomicity invariants)
// Tickets:
//   - T045 — Locations spine + 3 children + events (007_locations.sql)
//   - T046 — Locations RLS fix-forward (008_locations_owner_read.sql)
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

test.describe("Phase 1 — Locations (T045 + T046)", () => {
  // ------------------------------------------------------------
  // T045 — locations spine
  // Exit criterion clause: "all tables exist; RLS matrix passes"
  // Ticket: development/tickets/done/T045-locations-schema.md
  // ------------------------------------------------------------

  test.describe("T045 — public.locations spine", () => {
    test("Given the migrations have applied | When we describe locations | Then the b1 column set is present including geography(Point, 4326)", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "locations" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "member_id",
          "kind",
          "label",
          "slug",
          "description",
          "geography",
          "parent_location_id",
          "brand_label",
          "discoverability",
          "ambient_extras",
          "embedding_id",
          "federation_origin",
          "deleted_at",
          "created_at",
          "updated_at",
        ]),
      );
      // Why: ADR-14 / location.md — proximity queries depend on a single
      // geography(Point, 4326) column on the spine, even for area kinds
      // (centroid synced from the polygon child via trigger).
      const geog = cols.find((c) => c.column_name === "geography");
      expect(geog?.data_type).toMatch(/geography/);
      expect(geog?.is_nullable).toBe("NO");
    });

    test("Given locations spine exists | When we attempt to insert a row with kind='invalid' | Then the CHECK constraint rejects it", async () => {
      const probeOwnerId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: probeOwnerId });
      await admin.from("members").insert({ id: probeOwnerId, handle: `loc-kind-${probeOwnerId.slice(0, 6)}`, display_name: "Loc Kind Probe" });

      const { error } = await admin.from("locations").insert({
        member_id: probeOwnerId,
        kind: "invalid_kind",
        label: "Bad Kind",
        slug: `bad-kind-${probeOwnerId.slice(0, 6)}`,
        geography: "POINT(-121.5 38.6)",
      });
      // Why: ADR-14 locks kind at create — only permanent / recurring_temporary
      // / area are valid. CHECK rejection prevents drift via direct writes.
      expect(error?.code).toBe("23514");

      await admin.from("members").delete().eq("id", probeOwnerId);
      await cleanupAuthUsers([probeOwnerId]);
    });

    test("Given the migrations have applied | When we list locations indexes | Then the four expected indexes exist (incl. GIST partial)", async () => {
      const { data, error } = await admin.rpc("eval_indexes_for_table", { p_table: "locations" });
      expect(
        error,
        "helper eval_indexes_for_table missing — build adds: " +
          "create function public.eval_indexes_for_table(p_table text) returns table(indexname text, indexdef text) language sql security definer set search_path = public, pg_catalog as $$ select indexname::text, indexdef::text from pg_indexes where schemaname = 'public' and tablename = p_table order by indexname $$;",
      ).toBeNull();
      const idx = data as Array<{ indexname: string; indexdef: string }>;
      const names = idx.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          "idx_locations_geog",
          "idx_locations_member",
          "idx_locations_listed",
          "idx_locations_active",
        ]),
      );
      const geog = idx.find((r) => r.indexname === "idx_locations_geog");
      // Why: T046 swapped the GIST to partial (`where deleted_at is null`) per
      // location.md line 136 so soft-deleted Locations don't bloat the
      // proximity index.
      expect(geog?.indexdef).toMatch(/USING gist/i);
      expect(geog?.indexdef).toMatch(/where \(deleted_at is null\)/i);
    });

    // T045 + T046 — RLS matrix on the spine. Three policies after T046:
    //   - locations_public_read    (listed / unlisted, deleted_at IS NULL)
    //   - locations_owner_update   (member_id = auth.uid())
    //   - locations_owner_read     (member_id = auth.uid() AND deleted_at IS NULL)
    test.describe("RLS matrix on public.locations", () => {
      test("Given a Member's private Location | When anon queries it | Then the row is NOT returned (private discoverability)", async () => {
        const ownerId = randomUUID();
        await admin.rpc("eval_seed_auth_user_only", { p_id: ownerId });
        await admin.from("members").insert({ id: ownerId, handle: `loc-priv-${ownerId.slice(0, 6)}`, display_name: "Loc Private Owner" });

        const slug = `loc-priv-${ownerId.slice(0, 6)}`;
        const { error: insErr } = await admin.from("locations").insert({
          member_id: ownerId,
          kind: "permanent",
          label: "Private Kitchen",
          slug,
          discoverability: "private",
          geography: "POINT(-121.4944 38.5816)",
        });
        expect(insErr).toBeNull();

        // Why: location.md "anti-doxxing" intent — `private` Locations
        // (canonical example: Maya's home-kitchen) must never appear in
        // proximity / browse / OG paths. Anon must see zero rows.
        const { data: anonRead } = await anon.from("locations").select("id").eq("slug", slug);
        expect(anonRead).toHaveLength(0);

        await admin.from("locations").delete().eq("slug", slug);
        await admin.from("members").delete().eq("id", ownerId);
        await cleanupAuthUsers([ownerId]);
      });

      test("Given a listed Location | When anon queries it | Then the row IS returned", async () => {
        const ownerId = randomUUID();
        await admin.rpc("eval_seed_auth_user_only", { p_id: ownerId });
        await admin.from("members").insert({ id: ownerId, handle: `loc-lst-${ownerId.slice(0, 6)}`, display_name: "Loc Listed Owner" });

        const slug = `loc-lst-${ownerId.slice(0, 6)}`;
        await admin.from("locations").insert({
          member_id: ownerId,
          kind: "permanent",
          label: "Drake's the Barn",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5295 38.5747)",
        });

        const { data } = await anon.from("locations").select("id, slug").eq("slug", slug);
        expect(data).toHaveLength(1);

        await admin.from("locations").delete().eq("slug", slug);
        await admin.from("members").delete().eq("id", ownerId);
        await cleanupAuthUsers([ownerId]);
      });

      test("Given a soft-deleted listed Location | When anon queries it | Then the row is NOT returned (deleted_at IS NULL gate)", async () => {
        const ownerId = randomUUID();
        await admin.rpc("eval_seed_auth_user_only", { p_id: ownerId });
        await admin.from("members").insert({ id: ownerId, handle: `loc-del-${ownerId.slice(0, 6)}`, display_name: "Loc Del Owner" });

        const slug = `loc-del-${ownerId.slice(0, 6)}`;
        await admin.from("locations").insert({
          member_id: ownerId,
          kind: "permanent",
          label: "Deleted",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
          deleted_at: new Date().toISOString(),
        });

        // Why: soft-deleted Locations stop participating in every public
        // surface — the public-read policy filters them out and the partial
        // GIST drops them from the proximity index (T046).
        const { data } = await anon.from("locations").select("id").eq("slug", slug);
        expect(data).toHaveLength(0);

        await admin.from("locations").delete().eq("slug", slug);
        await admin.from("members").delete().eq("id", ownerId);
        await cleanupAuthUsers([ownerId]);
      });

      test("Given anon has no auth.uid() | When anon attempts INSERT into locations | Then it is rejected (no insert policy applies)", async () => {
        // Why: ADR-7 — locations writes flow through the action layer's
        // location.create handler; no anon insert policy exists.
        const { error } = await anon.from("locations").insert({
          member_id: SYSTEM_MEMBER_ID,
          kind: "permanent",
          label: "Should fail",
          slug: `anon-loc-${randomUUID().slice(0, 6)}`,
          geography: "POINT(-121.5 38.5)",
        });
        expect(error, "anon insert into locations must fail").not.toBeNull();
      });
    });
  });

  // ------------------------------------------------------------
  // T045 — child tables (per-child public-read mirrors via EXISTS subquery)
  // ------------------------------------------------------------

  test.describe("T045 — child tables (permanent / recurring_temporary / areas)", () => {
    test("Given location_permanent exists | When we describe it | Then it carries (location_id, street_address, public_hours, accessibility_notes)", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "location_permanent" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining(["location_id", "street_address", "public_hours", "accessibility_notes"]),
      );
    });

    test("Given location_recurring_temporary exists | When we describe it | Then it carries (location_id, recurrence_rule, session_start_time, session_end_time)", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "location_recurring_temporary" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining(["location_id", "recurrence_rule", "session_start_time", "session_end_time"]),
      );
    });

    test("Given location_areas exists | When we describe it | Then it carries (location_id, polygon geography(Polygon), area_kind, radius_meters)", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "location_areas" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(["location_id", "polygon", "area_kind", "radius_meters"]));
      const poly = cols.find((c) => c.column_name === "polygon");
      expect(poly?.data_type).toMatch(/geography/);
      expect(poly?.is_nullable).toBe("NO");
    });

    test("Given a location_areas row is inserted | When the centroid-sync trigger fires | Then the spine row's geography equals ST_Centroid(polygon)", async () => {
      const ownerId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: ownerId });
      await admin.from("members").insert({ id: ownerId, handle: `area-${ownerId.slice(0, 6)}`, display_name: "Area Owner" });

      const slug = `area-${ownerId.slice(0, 6)}`;
      const placeholder = "POINT(-121.50 38.58)";
      const { data: spineRows } = await admin
        .from("locations")
        .insert({
          member_id: ownerId,
          kind: "area",
          label: "Concerts in the Park footprint",
          slug,
          discoverability: "listed",
          geography: placeholder,
        })
        .select("id");
      const locId = spineRows?.[0]?.id as string;
      expect(locId).toBeTruthy();

      // A small square polygon — centroid is the geometric center.
      const polygon =
        "POLYGON((-121.50 38.58, -121.48 38.58, -121.48 38.60, -121.50 38.60, -121.50 38.58))";

      const { error: areaErr } = await admin.from("location_areas").insert({
        location_id: locId,
        polygon,
        area_kind: "neighborhood",
      });
      expect(areaErr).toBeNull();

      // Why: location.md / T045 — the cross-kind uniformity of proximity
      // queries depends on the spine's geography being the polygon centroid
      // for area kinds. The trigger encodes that invariant.
      const { data, error } = await admin.rpc("eval_location_geography_text", { p_location_id: locId });
      expect(
        error,
        "helper eval_location_geography_text missing — build adds: " +
          "create function public.eval_location_geography_text(p_location_id uuid) returns text language sql security definer set search_path = public, extensions, pg_catalog as $$ select ST_AsText(geography::geometry) from public.locations where id = p_location_id $$;",
      ).toBeNull();
      // Centroid of the unit square above is (-121.49, 38.59). ST_AsText emits
      // full double precision, so match with tolerance rather than exact decimals.
      const match = (data as unknown as string).match(/POINT\((-?\d+\.?\d*)\s+(-?\d+\.?\d*)\)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeCloseTo(-121.49, 4);
      expect(Number(match![2])).toBeCloseTo(38.59, 4);

      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", ownerId);
      await cleanupAuthUsers([ownerId]);
    });

    test("Given a child row references a private spine row | When anon queries the child | Then RLS returns zero rows (mirror-per-child)", async () => {
      const ownerId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: ownerId });
      await admin.from("members").insert({ id: ownerId, handle: `child-priv-${ownerId.slice(0, 6)}`, display_name: "Child Priv" });

      const slug = `child-priv-${ownerId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: ownerId,
          kind: "permanent",
          label: "Private",
          slug,
          discoverability: "private",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      await admin.from("location_permanent").insert({
        location_id: locId,
        street_address: "1234 Private Way",
      });

      // Why: per-child public-read policies use an EXISTS subquery against
      // the spine's discoverability — a private spine row must hide its
      // child row too. Otherwise the address leaks via the child surface.
      const { data } = await anon.from("location_permanent").select("location_id").eq("location_id", locId);
      expect(data).toHaveLength(0);

      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", ownerId);
      await cleanupAuthUsers([ownerId]);
    });
  });

  // ------------------------------------------------------------
  // T045 — location_events partitioned monthly + audit fields
  // ------------------------------------------------------------

  test.describe("T045 — public.location_events (partitioned monthly)", () => {
    test("Given the migrations have applied | When we describe location_events | Then audit fields + composite PK are present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "location_events" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "location_id",
          "event_kind",
          "payload",
          "acting_member_id",
          "via_delegation_id",
          "created_at",
        ]),
      );
      // Why: ADR-6 — every event row carries acting_member_id NOT NULL so the
      // audit trail can never be silently truncated. via_delegation_id is
      // nullable (system-emitted events have no delegating Member).
      const acting = cols.find((c) => c.column_name === "acting_member_id");
      expect(acting?.is_nullable).toBe("NO");
      const viaDelegation = cols.find((c) => c.column_name === "via_delegation_id");
      expect(viaDelegation?.is_nullable).toBe("YES");
    });

    test("Given location_events is partitioned | When we ask pg_class | Then relkind='p' (partition parent)", async () => {
      const { data, error } = await admin.rpc("eval_is_partitioned", { p_table: "location_events" });
      expect(error).toBeNull();
      // Why: ADR-10 → ADR-7 partition rotation cadence. Monthly partitioning
      // keeps event-log queries bounded and the rotation function (seeded
      // current + 2 future months at migration time) gates the cadence.
      expect(data).toBe(true);
    });

    test("Given current+2 future months should be seeded | When we count location_events partitions | Then at least 3 exist", async () => {
      const { data, error } = await admin.rpc("eval_partition_count", { p_parent: "location_events" });
      expect(
        error,
        "helper eval_partition_count missing — build adds: " +
          "create function public.eval_partition_count(p_parent text) returns integer language sql security definer set search_path = public, pg_catalog as $$ select count(*)::integer from pg_inherits i join pg_class c on c.oid = i.inhparent join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = p_parent $$;",
      ).toBeNull();
      // Why: rotate_location_events_partitions() seeds current + 2 future
      // months at migration time per T045 (mirrors T042 pattern for
      // member_events). At minimum 3 leaf partitions must exist after reset.
      expect(data as unknown as number).toBeGreaterThanOrEqual(3);
    });

    test("Given the location_events event_kind enum is locked | When we attempt to insert an unknown event_kind | Then the CHECK rejects it", async () => {
      const ownerId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: ownerId });
      await admin.from("members").insert({ id: ownerId, handle: `evt-${ownerId.slice(0, 6)}`, display_name: "Event Probe" });

      const slug = `evt-${ownerId.slice(0, 6)}`;
      const { data: spine } = await admin
        .from("locations")
        .insert({
          member_id: ownerId,
          kind: "permanent",
          label: "Evt",
          slug,
          discoverability: "listed",
          geography: "POINT(-121.5 38.5)",
        })
        .select("id");
      const locId = spine?.[0]?.id as string;

      // Why: location.md event-kind enum is the closed catalog of platform-
      // emitted events. A typo in a handler would silently land in
      // information_schema if not enforced; the CHECK is the floor.
      const { error } = await admin.from("location_events").insert({
        location_id: locId,
        event_kind: "location.totally_made_up",
        acting_member_id: ownerId,
      });
      expect(error?.code).toBe("23514");

      await admin.from("locations").delete().eq("id", locId);
      await admin.from("members").delete().eq("id", ownerId);
      await cleanupAuthUsers([ownerId]);
    });
  });
});

// ------------------------------------------------------------
// Helpers — local to this spec.
// ------------------------------------------------------------

async function cleanupAuthUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // Best-effort; the bootstrap script keeps row pollution scoped to dev.
    }
  }
}
