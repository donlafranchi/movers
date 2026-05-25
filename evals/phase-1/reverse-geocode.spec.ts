import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Phase 1 — Reverse-geocoder PG function (T059).
//
// Source of truth:
//   - product/systems/places.md § Reverse-geocoder contract
//   - planning/adrs/ADR-0020-locality-scoped-urls.md § Anchoring rules
//   - planning/bundles/b1x-substrate-sprint.md § A2
//   - web/supabase/migrations/022_places_reverse_geocode.sql
//
// Tests the SECURITY DEFINER function public.place_for_coords. The TS
// wrapper (web/src/lib/places/reverse-geocode.ts) is unit-tested separately
// in tests/reverse-geocode.test.ts with mocked clients.
//
// Test strategy: inject synthetic polygons into seeded places, query the
// function via RPC, assert most-specific-wins. Polygons revert at the end
// of each test so the seed remains polygon-free (T2 deliverable per spec).

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let admin: SupabaseClient;
let anon: SupabaseClient;

// Serial mode — these tests mutate shared place rows (polygon column) and
// rely on per-test setup/teardown. fullyParallel would let one test's
// setPolygon leak into another's containment query.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

// A tiny multipolygon covering a 0.01° × 0.01° square around the named
// center. Synthetic; just enough to test containment semantics.
function squareAround(lat: number, lon: number, half = 0.005): string {
  const south = lat - half;
  const north = lat + half;
  const west = lon - half;
  const east = lon + half;
  // Note: WKT uses lon lat order. Build a MultiPolygon (the column type).
  return `MULTIPOLYGON(((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south})))`;
}

async function setPolygon(slug: string, kind: string, wkt: string): Promise<void> {
  // ADR-0022 brought ambiguous-by-slug rows (e.g., Sacramento exists as
  // both county and city) — kind is required to disambiguate.
  await admin.rpc("eval_set_place_polygon", { p_slug: slug, p_kind: kind, p_wkt: wkt });
}

async function clearPolygon(slug: string, kind: string): Promise<void> {
  await admin.rpc("eval_set_place_polygon", { p_slug: slug, p_kind: kind, p_wkt: null });
}

test.describe("Phase 1 — Reverse-geocoder (T059)", () => {
  test.describe("T059 — public.place_for_coords function shape", () => {
    test("Given the migration has applied | When we call place_for_coords with no polygons | Then it returns zero rows", async () => {
      const { data, error } = await admin.rpc("place_for_coords", {
        p_lat: 38.5816,
        p_lon: -121.4944,
      });
      expect(error).toBeNull();
      expect((data as unknown[]).length).toBe(0);
    });

    test("Given the function is granted to anon | When anon calls place_for_coords | Then it returns without an auth error", async () => {
      const { error } = await anon.rpc("place_for_coords", {
        p_lat: 38.5816,
        p_lon: -121.4944,
      });
      expect(error).toBeNull();
    });
  });

  test.describe("T059 — polygon containment (Layer 1)", () => {
    test("Given a polygon is set on Oak Park | When we query a coordinate inside | Then we resolve to Oak Park", async () => {
      // Oak Park, Sacramento — approximate center 38.534, -121.466.
      await setPolygon("oak-park", "neighborhood", squareAround(38.534, -121.466));
      try {
        const { data, error } = await admin.rpc("place_for_coords", {
          p_lat: 38.534,
          p_lon: -121.466,
        });
        expect(error).toBeNull();
        const rows = data as Array<{ place_id: string; kind: string }>;
        expect(rows.length).toBe(1);
        expect(rows[0]!.kind).toBe("neighborhood");

        // Cross-check the place_id resolves to the right slug.
        const { data: sluRow } = await admin
          .from("places")
          .select("slug")
          .eq("id", rows[0]!.place_id)
          .single();
        expect(sluRow!.slug).toBe("oak-park");
      } finally {
        await clearPolygon("oak-park", "neighborhood");
      }
    });

    test("Given a coordinate is outside any polygon | When we query | Then we get zero rows", async () => {
      await setPolygon("oak-park", "neighborhood", squareAround(38.534, -121.466));
      try {
        const { data } = await admin.rpc("place_for_coords", {
          p_lat: 47.6062, // Seattle — nowhere near Oak Park
          p_lon: -122.3321,
        });
        expect((data as unknown[]).length).toBe(0);
      } finally {
        await clearPolygon("oak-park", "neighborhood");
      }
    });

    test("Given both Oak Park and a containing Sacramento polygon are set | When we query a point inside both | Then the smaller (Oak Park) wins", async () => {
      // Encodes the most-specific-match-wins rule from places.md.
      // Oak Park: 0.01° square around (38.534, -121.466).
      // Sacramento: 0.04° square around the same center (4× wider) — strict superset.
      await setPolygon("oak-park", "neighborhood", squareAround(38.534, -121.466, 0.005));
      await setPolygon("sacramento", "city", squareAround(38.534, -121.466, 0.02));
      try {
        const { data } = await admin.rpc("place_for_coords", {
          p_lat: 38.534,
          p_lon: -121.466,
        });
        const rows = data as Array<{ place_id: string; kind: string }>;
        expect(rows.length).toBe(1);
        expect(rows[0]!.kind).toBe("neighborhood");
      } finally {
        await clearPolygon("oak-park", "neighborhood");
        await clearPolygon("sacramento", "city");
      }
    });

    test("Given Sacramento (city) has a polygon but Oak Park does not | When we query a point inside Sacramento | Then it falls through to the city", async () => {
      await setPolygon("sacramento", "city", squareAround(38.534, -121.466, 0.02));
      try {
        const { data } = await admin.rpc("place_for_coords", {
          p_lat: 38.534,
          p_lon: -121.466,
        });
        const rows = data as Array<{ place_id: string; kind: string }>;
        expect(rows.length).toBe(1);
        expect(rows[0]!.kind).toBe("city");
      } finally {
        await clearPolygon("sacramento", "city");
      }
    });

    test("Given a soft-deleted place with a polygon | When we query a point inside | Then it is NOT returned (the deleted_at filter applies)", async () => {
      // Why: the function's WHERE clause filters out deleted_at. Confirms
      // that a soft-removed place doesn't keep claiming coordinates.
      await setPolygon("midtown", "neighborhood", squareAround(38.572, -121.480, 0.005));
      const midtown = await admin
        .from("places")
        .select("id")
        .eq("slug", "midtown")
        .single();

      try {
        // Soft-delete Midtown.
        await admin
          .from("places")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", midtown.data!.id);

        const { data } = await admin.rpc("place_for_coords", {
          p_lat: 38.572,
          p_lon: -121.480,
        });
        expect((data as unknown[]).length).toBe(0);
      } finally {
        // Restore Midtown.
        await admin
          .from("places")
          .update({ deleted_at: null })
          .eq("id", midtown.data!.id);
        await clearPolygon("midtown", "neighborhood");
      }
    });
  });
});
