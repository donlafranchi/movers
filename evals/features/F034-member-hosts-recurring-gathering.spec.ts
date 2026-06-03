import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { seedF034Fixture, JORDAN, CREW, type SeededF034Fixture } from "../fixtures/F034-gathering";

// F034: A member hosts a recurring gathering at a venue
// Source: planning/now/scenario-F034-member-hosts-recurring-gathering.md
//
// Strategy mirrors F038/F040 (seed read-side state once, verify the public
// surfaces beat-by-beat) plus one authed reachability beat for the "/you/sell"
// "Host a gathering" entry.
//
// Coverage note — beats verified off this surface:
//   - "Recurring gathering writes Item + child + events in one transaction" and
//     "composer asks 'what kind' in user language" are verified at the handler /
//     component layer by T080/T084's vitest suites (the build sandbox can't reach
//     a live DB from vitest). This eval proves the READ join end-to-end: a seeded
//     gathering surfaces its items row (title), item_gatherings child
//     (recurrence → "Every Thursday", cost), item_locations venue, and the
//     Share-link together — the read contract the transaction must satisfy.
//   - "Item appears on venue page + locality feed" depends on surfaces not wired
//     here (venue "What's happening" + F030 feed) — out of scope for this spec.

let SEEDED: SeededF034Fixture;
test.beforeAll(async () => {
  SEEDED = await seedF034Fixture();
});

test.describe("F034 — A member hosts a recurring gathering", () => {
  test.describe("Beat 1 — Item page under a Group: next occurrence + recurrence + venue + Free cost + brand + Share-link", () => {
    test("Given a published recurring gathering filed under a Group at its place-scoped URL | When any viewer loads it | Then title, next-occurrence, recurrence, venue, Free cost, brand link, owner link, and the Share-link render", async ({
      page,
    }) => {
      const gathering = SEEDED.groupGathering;

      // When — anonymous navigation (public Item surface)
      const res = await page.goto(gathering.url);

      // Then — the page resolves via the `/p/[…place]/g/<group>/e/<slug>-<id8>`
      // catch-all dispatch (the `/e/` marker; ADR-20 + ADR-22). A non-200 means
      // the place-scoped + id-fragment addressing no longer resolves.
      expect(res?.status()).toBe(200);

      // Then — title (items.title)
      await expect(page.getByTestId("gathering-title")).toHaveText(gathering.title);

      // Then — next occurrence renders as a human date (computed by the route).
      // Why: AC "Item page shows next occurrence + Share-link". The exact date
      // depends on the wall clock; its presence proves the occurrence computed.
      await expect(page.getByTestId("gathering-next-occurrence")).toBeVisible();

      // Then — recurrence in human terms. Why: AC — "recurring pattern in human
      // terms". FREQ=WEEKLY;BYDAY=TH → "Every Thursday" (deterministic).
      await expect(page.getByTestId("gathering-recurrence")).toHaveText(
        "Every Thursday",
      );

      // Then — venue (item_locations → locations.label). Why: AC — "Location
      // with map pin"; the read join surfaces the attached venue label.
      await expect(page.getByTestId("gathering-location")).toContainText(
        "Drake's at the River",
      );

      // Then — free gathering renders "Free" (cost_cents NULL). Why: Data
      // Captured — "Cost … null = free".
      await expect(page.getByTestId("gathering-cost")).toHaveText("Free");

      // Then — Group attribution: "Hosted by <Group name>" links to the Group page.
      // T095: Group-filed items attribute to the Group; the personal Member
      // behind the Group is separately gated.
      const attribution = page.getByTestId("gathering-attribution-link");
      await expect(attribution).toHaveText(CREW.brandName);
      await expect(attribution).toHaveAttribute(
        "href",
        new RegExp(`/g/${CREW.slug}$`),
      );

      // Then — the Share-link affordance is present. Why: AC — "a 'Share link'
      // affordance that copies the canonical URL".
      await expect(page.getByTestId("gathering-share-link")).toBeVisible();
    });
  });

  test.describe("Beat 2 — Member-hosted path (no Group filing)", () => {
    test("Given a recurring gathering hosted by the Member | When loaded at /m/<handle>/e/<slug> | Then it renders with the owner link and NO brand label (the scenario-canonical b1 shape)", async ({
      page,
    }) => {
      const gathering = SEEDED.memberGathering;

      // Why: AC "If no venue is attached … URL falls back to /m/[handle]/e/[…]"
      // + scenario implicit items.group_id=NULL — a Member-hosted gathering
      // resolves at the Member-scoped URL with no brand resolve-up.
      const res = await page.goto(gathering.url);
      expect(res?.status()).toBe(200);
      expect(gathering.url).toMatch(new RegExp(`^/m/${JORDAN.handle}/e/`));

      await expect(page.getByTestId("gathering-title")).toHaveText(gathering.title);
      // T095 — Attribution to the host Member: linked when discoverable, plain
      // text otherwise. Eval fixture must set is_discoverable=true on JORDAN for
      // the link assertion to hold; plain-text path is covered by unit tests.
      await expect(page.getByTestId("gathering-attribution-link")).toHaveAttribute(
        "href",
        `/m/${JORDAN.handle}`,
      );
      await expect(page.getByTestId("gathering-recurrence")).toHaveText(
        "Every Thursday",
      );
    });
  });

  test.describe("Beat 3 — Paid gathering renders a formatted cost", () => {
    test("Given a gathering with a drop-in cost | When the Item page renders | Then the cost reads the formatted dollar amount", async ({
      page,
    }) => {
      // Why: Data Captured "Cost → item_gatherings.cost_cents". cost_cents=1000
      // → "$10.00". Guards the priced branch of the cost formatter.
      const res = await page.goto(SEEDED.paidGathering.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("gathering-cost")).toHaveText("$10.00");
    });
  });

  test.describe("Beat 4 — Unpublished gatherings are not publicly resolvable", () => {
    test("Given a draft gathering | When an anonymous viewer hits its URL | Then the page returns 404 (RLS items_select_published gate)", async ({
      page,
    }) => {
      // Why: scenario implicit state='published' + RLS items_select_published —
      // only published, non-deleted Items resolve. A draft must 404, not leak.
      const res = await page.goto(SEEDED.draftGathering.url);
      expect(res?.status()).toBe(404);
    });
  });

  test.describe("Beat 5 — 'Host a gathering' is reachable from /you/sell", () => {
    test("Given Jordan owns a business Group and is signed in | When he opens /you/sell | Then a 'Host a gathering' affordance for that Group is present", async ({
      page,
    }) => {
      // Given — Jordan, the founder/owner, signed in via the UI flow
      await signIn(page, JORDAN.email, JORDAN.password);

      // When
      const res = await page.goto("/you/sell");

      // Then — the sell index renders his Group with the entry affordance.
      // Why: scenario Surfaces — secondary entry "/you 'Host a gathering'
      // affordance". (Driving the composer itself is deferred per the header.)
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("you-sell-index")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Host a gathering/i }).first(),
      ).toBeVisible();
    });
  });
});
