import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { seedF038Fixture, MAYA, SHOP, type SeededF038Fixture } from "../fixtures/F038-product";

// F038: A producer lists a product
// Source: planning/now/scenario-F038-producer-lists-product.md
//
// Strategy mirrors F035 (seed read-side state once, verify the public surfaces
// beat-by-beat) plus one authed reachability beat for the "/you/sell" entry.
//
// Coverage note — two acceptance beats are verified off this surface:
//   - "Composer writes Item + child + Location in one transaction" is verified
//     at the handler layer by T077's vitest suite (the build sandbox can't reach
//     a live DB from vitest). This eval proves the READ join end-to-end: a single
//     seeded Item surfaces its items row (title), item_products child (price),
//     and item_locations pickup (label) together — the read contract the
//     transaction must satisfy. Driving the multi-step composer UI is deferred
//     (the b1 pickup picker renders from a stubbed location set — fragile to
//     drive blind); the reachability beat asserts the entry affordance exists.
//   - "Product appears in locality feed" depends on the F030 awareness feed,
//     not yet wired to this surface — out of scope for this spec.

let SEEDED: SeededF038Fixture;
test.beforeAll(async () => {
  SEEDED = await seedF038Fixture();
});

test.describe("F038 — A producer lists a product", () => {
  test.describe("Beat 1 — Item page under a Group: brand resolve-up + owner + pickup + skip-provenance", () => {
    test("Given a published product filed under a business Group at its place-scoped URL | When any viewer loads it | Then title, price, brand link, owner link, and pickup render — and NO Locally Made badge (skip-provenance)", async ({
      page,
    }) => {
      const product = SEEDED.paidGroup;

      // When — anonymous navigation (public Item surface, per F035 beat 5 posture)
      const res = await page.goto(product.url);

      // Then — the page resolves (URL follows /p/[…place]/g/<group>/p/<slug>-<id8>
      // per ADR-20 + ADR-22; a non-200 means the place-scoped + id-fragment
      // addressing the composer mints no longer resolves on the read side).
      expect(res?.status()).toBe(200);

      // Then — title (items.title)
      await expect(page.getByTestId("product-title")).toHaveText(product.title);

      // Then — price formatted from item_products (priced product → "$8.00 / loaf")
      // Why: AC "Item page shows brand resolve-up + owner" — price is part of the
      // Item-page contract; the "/ unit" suffix proves price_unit round-trips.
      await expect(page.getByTestId("product-price")).toHaveText("$8.00 / loaf");

      // Then — brand resolve-up: the Group's display_name links to the Group page
      // Why: AC "Item page shows brand resolve-up + owner" — items.brand_label is
      // derived from group_businesses.display_name and must link back to the Shop.
      const brand = page.getByTestId("product-brand-link");
      await expect(brand).toHaveText(SHOP.brandName);
      await expect(brand).toHaveAttribute(
        "href",
        new RegExp(`/g/${SHOP.slug}$`),
      );

      // Then — owner Member name links to /m/<handle>
      // Why: AC — the owning human stays visible (person-anchoring); the link
      // target must resolve to the founder's Member page.
      const owner = page.getByTestId("product-owner-link");
      await expect(owner).toHaveText(MAYA.displayName);
      await expect(owner).toHaveAttribute("href", `/m/${MAYA.handle}`);

      // Then — pickup point (item_locations → locations.label) renders
      // Why: AC — pickup point with a map pin. The read join surfaces the
      // attached Location's label; its presence proves item_locations resolved.
      await expect(page.getByTestId("product-pickup")).toContainText(
        "Maya's Oak Park Kitchen",
      );

      // Then — NO Locally Made badge (the F038 skip-provenance path)
      // Why: AC "Skip-provenance path" — made_at_place_id is NULL, so the badge
      // slot renders nothing. A badge here would mean the gate fires on a false
      // positive (mirror F035 beat 2's negative-branch assertion).
      await expect(page.getByTestId("product-made-badge")).toHaveCount(0);
      await expect(page.getByText(/locally made/i)).toHaveCount(0);
    });
  });

  test.describe("Beat 2 — Free product renders 'Free'", () => {
    test("Given a published product with no price | When the Item page renders | Then the price reads 'Free' instead of a number", async ({
      page,
    }) => {
      // Why: scenario Edge Case "Free product" — price_cents NULL, price_unit
      // NULL → page renders "Free". Guards the null-price formatting branch.
      const res = await page.goto(SEEDED.freeGroup.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("product-price")).toHaveText("Free");
    });
  });

  test.describe("Beat 3 — Sell-as-individual path (no Group filing)", () => {
    test("Given a published product with no Group | When loaded at /m/<handle>/p/<slug> | Then it renders with the owner link and NO brand label", async ({
      page,
    }) => {
      const product = SEEDED.individual;

      // Why: scenario Edge Case "Sell as individual" + AC "Item URL follows …" —
      // an Item with group_id NULL falls back to the Member-scoped URL and shows
      // no brand resolve-up (brand_label NULL).
      const res = await page.goto(product.url);
      expect(res?.status()).toBe(200);
      expect(product.url).toMatch(new RegExp(`^/m/${MAYA.handle}/p/`));

      await expect(page.getByTestId("product-title")).toHaveText(product.title);
      await expect(page.getByTestId("product-owner-link")).toHaveAttribute(
        "href",
        `/m/${MAYA.handle}`,
      );

      // Then — no brand resolve-up for an individually-sold Item
      await expect(page.getByTestId("product-brand-link")).toHaveCount(0);
      await expect(page.getByTestId("product-brand")).toHaveCount(0);
    });
  });

  test.describe("Beat 4 — Locally Made badge is data-gated (positive control)", () => {
    test("Given a product WITH a made_at_place_id claim | When the Item page renders | Then the Locally Made badge IS present — proving the skip-path absence is data-driven, not a dead render path", async ({
      page,
    }) => {
      // The positive control locks the seam F038's skip-path leaves empty: if the
      // badge can never render, beat 1's absence assertion is meaningless. Skips
      // gracefully if no place row existed to anchor the claim.
      test.skip(
        SEEDED.madeGroup === null,
        "no seeded place row to anchor a made_at claim",
      );
      const res = await page.goto(SEEDED.madeGroup!.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("product-made-badge")).toBeVisible();
      await expect(page.getByTestId("product-made-badge")).toContainText(
        /locally made/i,
      );
    });
  });

  test.describe("Beat 5 — Unpublished products are not publicly resolvable", () => {
    test("Given a draft product | When an anonymous viewer hits its URL | Then the page returns 404 (RLS items_select_published gate)", async ({
      page,
    }) => {
      // Why: AC "Composer writes … state='published'" + RLS items_select_published
      // — only published, non-deleted Items resolve. A draft must 404, not leak.
      const res = await page.goto(SEEDED.draftGroup.url);
      expect(res?.status()).toBe(404);
    });
  });

  test.describe("Beat 6 — 'Add a product' is reachable from /you/sell", () => {
    test("Given Maya owns a business Group and is signed in | When she opens /you/sell | Then an 'Add a product' affordance for that Group is present", async ({
      page,
    }) => {
      // Given — Maya, the founder/owner, signed in via the UI flow
      await signIn(page, MAYA.email, MAYA.password);

      // When
      const res = await page.goto("/you/sell");

      // Then — the sell index renders her shop with the entry affordance
      // Why: AC "'Add a product' reachable from Group page + /you" — the entry
      // point into the composer must exist for an owner. (Driving the composer
      // itself is deferred per the file-header coverage note.)
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("you-sell-index")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Add a product/i }).first(),
      ).toBeVisible();
    });
  });
});
