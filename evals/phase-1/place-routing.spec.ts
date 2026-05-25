import { test, expect } from "@playwright/test";

// Phase 1 — Place URL routing (T060).
//
// Source of truth:
//   - product/systems/places.md § URL-prefix derivation
//   - planning/adrs/ADR-0020-locality-scoped-urls.md § URL hierarchy
//   - planning/bundles/b1x-substrate-sprint.md § A3
//   - web/src/app/p/[...slug]/page.tsx
//   - web/src/lib/places/resolve-path.ts
//   - web/src/components/place-breadcrumb.tsx
//
// Seeded chain: California (state, slug 'ca') → Sacramento County → Sacramento City
//   → 5 neighborhoods (Oak Park, etc.) AND Yolo County → West Sacramento (city).
//
// ADR-0022 URL conventions:
//   - State slug is the 2-letter USPS code ('ca' not 'california').
//   - Counties are URL-skippable: when a city of the same slug exists
//     under the state, the URL goes to the city. The county tier exists
//     in the data substrate but is transparent in the URL.
//   - A county appears in a URL only when no city of that slug exists
//     (e.g. /p/ca/yolo → Yolo County, because no city 'yolo' exists).
//
// b1.x scope boundary (DEVIATIONS § T060): catch-all only handles BARE
// place URLs. /p/<place>/g/<group> shapes ship at b1.1+ via dispatch
// inside the same page.tsx (Next.js doesn't allow a static segment after a
// catch-all).

test.describe("Phase 1 — Place routing (T060)", () => {
  test("Given /p/ca/sacramento/oak-park | When we GET | Then we see the Oak Park landing (county tier skipped in URL)", async ({
    page,
  }) => {
    const res = await page.goto("/p/ca/sacramento/oak-park");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("place-display-name")).toHaveText("Oak Park");
    await expect(page.getByTestId("place-kind")).toHaveText("neighborhood");
  });

  test("Given the deepest path | When we render the breadcrumb | Then it has 3 nodes (California → Sacramento city → Oak Park) — county skipped", async ({
    page,
  }) => {
    await page.goto("/p/ca/sacramento/oak-park");
    const items = page.getByTestId("place-breadcrumb").locator("li");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("California");
    await expect(items.nth(1)).toContainText("Sacramento");
    await expect(items.nth(2)).toContainText("Oak Park");
    // The innermost node carries aria-current="page" (no link).
    await expect(items.nth(2).locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("Given /p/ca/sacramento | When we GET | Then the resolver returns the CITY (city beats county on slug collision)", async ({
    page,
  }) => {
    // Encodes ADR-0022 county-skip semantics: when a city of the same slug
    // exists under the state, the URL goes to the city.
    const res = await page.goto("/p/ca/sacramento");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("place-display-name")).toHaveText("Sacramento");
    await expect(page.getByTestId("place-kind")).toHaveText("city");
  });

  test("Given /p/ca/yolo (no city of that slug exists) | When we GET | Then the resolver falls through to the COUNTY", async ({
    page,
  }) => {
    // ADR-0022: counties are URL-addressable only when no city of the
    // same slug exists. Yolo has no city 'yolo'; the URL resolves to the
    // county.
    const res = await page.goto("/p/ca/yolo");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("place-display-name")).toHaveText("Yolo");
    await expect(page.getByTestId("place-kind")).toHaveText("county");
  });

  test("Given /p/ca/west-sacramento (city under Yolo County) | When we GET | Then we see the West Sacramento landing (county skipped)", async ({
    page,
  }) => {
    // West Sacramento is incorporated in Yolo County (ADR-0022 fix). The
    // URL skips the county tier — addressable directly from state.
    const res = await page.goto("/p/ca/west-sacramento");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("place-display-name")).toHaveText("West Sacramento");
    await expect(page.getByTestId("place-kind")).toHaveText("city");
  });

  test("Given a slug that does not exist | When we GET /p/atlantis | Then we 404", async ({
    page,
  }) => {
    const res = await page.goto("/p/atlantis");
    expect(res?.status()).toBe(404);
  });

  test("Given a 4-segment URL that tries to re-introduce the county | When we GET /p/ca/sacramento/sacramento/oak-park | Then we 404 (county is NOT a URL segment)", async ({
    page,
  }) => {
    // After /p/ca/sacramento resolves to Sacramento city, the next segment
    // is matched against children of the city. No city 'sacramento' exists
    // under Sacramento city, so the walk halts. Counties don't get a
    // second pass at this level.
    const res = await page.goto("/p/ca/sacramento/sacramento/oak-park");
    expect(res?.status()).toBe(404);
  });

  test("Given /p/ca/sacramento/atlantis | When we GET | Then we 404 (segment 2 misses below the city)", async ({
    page,
  }) => {
    const res = await page.goto("/p/ca/sacramento/atlantis");
    expect(res?.status()).toBe(404);
  });

  test("Given malformed segments | When we GET /p/HasCaps | Then we 404 (slug regex defense)", async ({
    page,
  }) => {
    const res = await page.goto("/p/HasCaps");
    expect(res?.status()).toBe(404);
  });
});
