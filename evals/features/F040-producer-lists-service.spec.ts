import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { seedF040Fixture, TOMAS, STUDIO, type SeededF040Fixture } from "../fixtures/F040-service";

// F040: A producer lists a service
// Source: planning/now/scenario-F040-producer-lists-service.md
//
// Strategy mirrors F038 (seed read-side state once, verify the public surfaces
// beat-by-beat) plus one authed reachability beat for the "/you/sell" entry.
//
// Coverage note — two acceptance beats are verified off this surface:
//   - "Composer writes Item + child in one transaction" is verified at the
//     handler layer by T081's vitest suite (the build sandbox can't reach a
//     live DB from vitest). This eval proves the READ join end-to-end: a single
//     seeded service Item surfaces its items row (title), item_services child
//     (rate_model / rate_cents → formatted rate), service_area_geography
//     (→ the service-area section), and brand resolve-up together — the read
//     contract the transaction must satisfy. Driving the multi-step composer UI
//     is deferred (mirrors F038); the reachability beat asserts the entry exists.
//   - "Service appears in locality feed" depends on the F030 awareness feed,
//     not yet wired to this surface — out of scope for this spec.

let SEEDED: SeededF040Fixture;
test.beforeAll(async () => {
  SEEDED = await seedF040Fixture();
});

test.describe("F040 — A producer lists a service", () => {
  test.describe("Beat 1 — Item page under a Group: brand resolve-up + owner + service area + rate", () => {
    test("Given a published service filed under a business Group at its place-scoped URL | When any viewer loads it | Then title, rate, brand link, owner link, and service area render — and NO Locally Made badge (services are excluded from provenance)", async ({
      page,
    }) => {
      const service = SEEDED.paidGroup;

      // When — anonymous navigation (public Item surface, per F038 beat 1 posture)
      const res = await page.goto(service.url);

      // Then — the page resolves (URL follows /p/[…place]/g/<group>/s/<slug>-<id8>
      // per ADR-20 + ADR-22; a non-200 means the place-scoped + id-fragment
      // addressing the composer mints no longer resolves on the read side).
      expect(res?.status()).toBe(200);

      // Then — title (items.title)
      await expect(page.getByTestId("service-title")).toHaveText(service.title);

      // Then — rate formatted from item_services (flat priced → "$50.00")
      // Why: AC "Item page shows brand + service area + pricing" — the rate is
      // part of the Item-page contract; the flat model formats as a bare amount.
      await expect(page.getByTestId("service-rate")).toHaveText("$50.00");

      // Then — brand resolve-up: the Group's display_name links to the Group page
      // Why: AC "Item page shows … brand resolve-up (if filed under Group)" —
      // items.brand_label derives from group_businesses.display_name and links
      // back to the Studio.
      const brand = page.getByTestId("service-brand-link");
      await expect(brand).toHaveText(STUDIO.brandName);
      await expect(brand).toHaveAttribute(
        "href",
        new RegExp(`/g/${STUDIO.slug}$`),
      );

      // Then — owner Member name links to /m/<handle>
      // Why: AC — "owner Member link"; the owning human stays visible
      // (person-anchoring); the link target must resolve to the founder's page.
      const owner = page.getByTestId("service-owner-link");
      await expect(owner).toHaveText(TOMAS.displayName);
      await expect(owner).toHaveAttribute("href", `/m/${TOMAS.handle}`);

      // Then — the service-area section renders (driven by a non-null
      // item_services.service_area_geography Polygon)
      // Why: AC — "service area (rendered as a circle on a map)"; the b1 surface
      // renders the area as a static statement, its presence proving the geography
      // resolved. The anchor Location label flows into the area copy.
      const area = page.getByTestId("service-area");
      await expect(area).toBeVisible();
      await expect(area).toContainText("Tomas's Midtown Studio");

      // Then — NO Locally Made badge anywhere on a service page
      // Why: AC "No Locally Made step on services" — services are excluded from
      // the provenance flow by kind; the badge must never surface on this page.
      await expect(page.getByText(/locally made/i)).toHaveCount(0);
    });
  });

  test.describe("Beat 2 — Free service renders 'Free'", () => {
    test("Given a published service with no rate | When the Item page renders | Then the rate reads 'Free' instead of a number", async ({
      page,
    }) => {
      // Why: scenario Edge Case "Free service" — rate_cents NULL (model 'flat')
      // → page renders "Free". Guards the null-rate formatting branch.
      const res = await page.goto(SEEDED.freeGroup.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("service-rate")).toHaveText("Free");
    });
  });

  test.describe("Beat 3 — Quote service renders 'Request a quote'", () => {
    test("Given a published service priced per engagement (rate_model='quote') | When the Item page renders | Then the rate reads 'Request a quote'", async ({
      page,
    }) => {
      // Why: the shipped rate_model enum is hourly|flat|quote|membership (T081
      // SPEC-PATCHES deviation). The 'quote' branch is the no-fixed-price path —
      // it must read "Request a quote", not "Free" or a number.
      const res = await page.goto(SEEDED.quoteGroup.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("service-rate")).toHaveText(
        "Request a quote",
      );
    });
  });

  test.describe("Beat 4 — Sell-as-individual path (no Group filing)", () => {
    test("Given a published service with no Group | When loaded at /m/<handle>/s/<slug> | Then it renders with the owner link and NO brand label", async ({
      page,
    }) => {
      const service = SEEDED.individual;

      // Why: scenario "If sold as individual, URL is /m/[handle]/s/[…]" + Edge
      // Case "No anchor Location" — an Item with group_id NULL falls back to the
      // Member-scoped URL and shows no brand resolve-up (brand_label NULL).
      const res = await page.goto(service.url);
      expect(res?.status()).toBe(200);
      expect(service.url).toMatch(new RegExp(`^/m/${TOMAS.handle}/s/`));

      await expect(page.getByTestId("service-title")).toHaveText(service.title);
      await expect(page.getByTestId("service-owner-link")).toHaveAttribute(
        "href",
        `/m/${TOMAS.handle}`,
      );

      // Then — hourly rate formats with the "/ hr" suffix
      await expect(page.getByTestId("service-rate")).toHaveText("$40.00 / hr");

      // Then — no brand resolve-up for an individually-sold Item
      await expect(page.getByTestId("service-brand-link")).toHaveCount(0);
      await expect(page.getByTestId("service-brand")).toHaveCount(0);
    });
  });

  test.describe("Beat 5 — Unpublished services are not publicly resolvable", () => {
    test("Given a draft service | When an anonymous viewer hits its URL | Then the page returns 404 (RLS items_select_published gate)", async ({
      page,
    }) => {
      // Why: AC "Composer writes … state='published'" + RLS items_select_published
      // — only published, non-deleted Items resolve. A draft must 404, not leak.
      const res = await page.goto(SEEDED.draftGroup.url);
      expect(res?.status()).toBe(404);
    });
  });

  test.describe("Beat 6 — 'Add a service' is reachable from /you/sell", () => {
    test("Given Tomas owns a business Group and is signed in | When he opens /you/sell | Then an 'Add a service' affordance for that Group is present", async ({
      page,
    }) => {
      // Given — Tomas, the founder/owner, signed in via the UI flow
      await signIn(page, TOMAS.email, TOMAS.password);

      // When
      const res = await page.goto("/you/sell");

      // Then — the sell index renders his studio with the entry affordance
      // Why: AC "'Add a service' reachable from Group page + /you" — the entry
      // point into the composer must exist for an owner. (Driving the composer
      // itself is deferred per the file-header coverage note.)
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("you-sell-index")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Add a service/i }).first(),
      ).toBeVisible();
    });
  });
});
