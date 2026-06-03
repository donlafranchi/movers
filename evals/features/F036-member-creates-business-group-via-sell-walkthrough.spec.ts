import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import {
  seedF036Fixture,
  resetMayaDrafts,
  MAYA as FIXTURE_MAYA,
  BAKER_RUTH as FIXTURE_RUTH,
  type SeededF036Fixture,
} from "../fixtures/F036-maya";

// F036: A member creates a business Group through the Sell walkthrough
// Source: planning/scenarios/F036-member-creates-business-group-via-sell-walkthrough.md
//
// One test per Given/When/Then beat in the scenario. The eval writer never reads
// code under web/src/ — these tests are written from the scenario alone.
//
// Note for the build agent: the scenario's "in one transaction" Then-clause (Beat 2)
// asserts substrate integrity that's hard to verify from the UI alone. These evals
// verify the observable outcome (the new Group page renders consistently — founder
// + owner role, brand name, anchor Location, listed discoverability surface). A
// matching unit test in the action-handler suite should verify the atomic write
// + event emission directly against the Postgres transaction boundary; if either
// row or event is missing, both that unit test AND this eval (via downstream
// rendering) must fail.

// --- Fixture conventions (assumed; build agent wires the seed helpers) ---
// `MAYA` is a seeded auth'd Member with at least one saved Location ("Maya's Kitchen")
// and NO existing kind='business' Group membership. The seed lives in the eval
// harness under web/evals/fixtures/F036-maya.ts; if absent at run time, the
// beforeEach setup escalates rather than stubs.
const MAYA = {
  email: "maya@example.test",
  password: "F036-test-password",
  handle: "maya-test",
  savedLocationName: "Maya's Kitchen",
};

// `BAKER_RUTH` is a seeded auth'd Member who already owns one kind='business' Group
// ("Ruth's Bread Co"). Used to verify the existing-business-Group routing.
const BAKER_RUTH = {
  email: "ruth@example.test",
  password: "F036-test-password",
  handle: "ruth-test",
  existingBusinessGroupName: "Ruth's Bread Co",
};

// Fixture seed (2026-06-01) — landed by `test` skill follow-up to T073.
// Seeds Maya + Ruth + their Locations + Ruth's active business Group, with
// real auth.users + members rows so the UI signIn flow can grant a session.
// Per-test isolation: Maya's draft Groups are reset before each test.
let SEEDED: SeededF036Fixture;
test.beforeAll(async () => {
  SEEDED = await seedF036Fixture();
});
test.beforeEach(async () => {
  await resetMayaDrafts(SEEDED.maya.memberId);
});
// Re-export so existing inline MAYA / BAKER_RUTH references resolve to the
// fixture's canonical values without rewriting every test body.
void FIXTURE_MAYA;
void FIXTURE_RUTH;

// Serial mode: every Maya-driven test shares one seeded identity
// (maya@example.test) and `resetMayaDrafts` wipes her draft + active business
// Groups in `beforeEach`. Under `fullyParallel: true` with multiple workers,
// one test's reset deletes another's in-flight draft mid-walkthrough and
// `group.activate` throws "group not found". The fixture's per-test reset is
// only sound when these run in order — pin the block to a single worker.
test.describe.configure({ mode: "serial" });

test.describe("F036 — Maya creates a business Group through the Sell walkthrough", () => {
  test.describe('"Sell" CTA visible on /you for any Member', () => {
    test("Given an auth'd Member with no business Group on /you | When the page loads | Then a 'Sell' CTA is visible routing to the walkthrough", async ({
      page,
    }) => {
      // Given — fresh Member, no kind='business' Group memberships
      await signIn(page, MAYA.email, MAYA.password);

      // When
      await page.goto("/you");

      // Then — "Sell" CTA visible
      // Why: per F036 scenario "The 'Sell' CTA on `/you` … route[s] to this walkthrough
      // for first-time Sellers". The CTA's presence is the entry-point contract for
      // Loop 9 (Make a living locally); its absence breaks the canonical example P1.
      await expect(
        page.getByRole("button", { name: /^Sell$/i })
      ).toBeVisible();
    });

    test("Given an auth'd Member who already has an active business Group | When /you loads | Then the 'Sell' CTA is still visible (routes to 'Add an Item' picker, not the walkthrough)", async ({
      page,
    }) => {
      // Given
      await signIn(page, BAKER_RUTH.email, BAKER_RUTH.password);

      // When
      await page.goto("/you");

      // Then — CTA is visible regardless of business-Group membership state
      // Why: per F036 scenario Then-clause "a 'Sell' CTA is visible, regardless of
      // whether they already have a business Group". The CTA never disappears
      // post-onboarding — its routing target changes (walkthrough vs Add an Item),
      // not its presence.
      const sellCta = page.getByRole("button", { name: /^Sell$/i });
      await expect(sellCta).toBeVisible();

      // And — tapping it does NOT open the walkthrough for an existing Seller
      // Why: scenario Out-of-Scope explicitly says "Multi-business-Group case: b2
      // surface". First-time Sellers get the walkthrough; existing Sellers get the
      // Add-an-Item routing. Conflating them would re-create the Group on every tap.
      await sellCta.click();
      await expect(
        page.getByRole("heading", { name: /Brand name/i })
      ).not.toBeVisible();
    });
  });

  test.describe("Walkthrough creates Group + founder membership in one transaction", () => {
    test("Given Maya completes brand + anchor + about steps and submits | When the walkthrough finishes | Then a kind='business' Group, group_businesses row, and founder owner-role membership all exist consistently", async ({
      page,
    }) => {
      // Given — clean Maya, on /you
      await signIn(page, MAYA.email, MAYA.password);
      await page.goto("/you");

      // When — drive the walkthrough end-to-end
      await page.getByRole("button", { name: /^Sell$/i }).click();

      // Step 1 — Brand name
      await page
        .getByLabel(/Brand name/i)
        .fill("Oak Park Sourdough");
      await page.getByRole("button", { name: /Continue/i }).click();

      // Step 2 — Anchor Location (pick existing)
      await page
        .getByRole("option", { name: new RegExp(MAYA.savedLocationName, "i") })
        .click();
      await page.getByRole("button", { name: /Continue/i }).click();

      // Step 3 — About
      await page
        .getByLabel(/About|Public description/i)
        .fill("Sourdough bread baked at home in Oak Park.");
      await page.getByRole("button", { name: /Continue/i }).click();

      // Step 4 — Locality (skip for this test; covered separately below)
      await page.getByRole("link", { name: /Skip this step/i }).click();

      // Step 5 — Final-step submit
      // Why: per design-language.md Multi-step composer recipe, final-step primary CTA
      // reads the destination verb (not "Done" or "Submit"). The scenario's "shop"
      // language + root CLAUDE.md naming-conventions table mean the label is "Create
      // my shop" (the build agent may also accept "Create my business Group" if the
      // PM ratifies that copy convention — either way the CTA fires group.activate).
      await page
        .getByRole("button", { name: /Create my (shop|business Group)/i })
        .click();

      // Then — observable outcome: Member is redirected to the new Group page,
      // which means activation succeeded and substrate is consistent
      // Why: in-one-transaction atomicity is the unit-test concern of the
      // action-handler suite. This eval verifies the integrated outcome — if any
      // of (groups row, group_businesses row, group_memberships row, events) is
      // missing or inconsistent, the Group page rendering below fails.
      await expect(page).toHaveURL(/\/p\/.+\/g\/oak-park-sourdough(-[a-z0-9]+)?$/);
      await expect(
        page.getByRole("heading", { name: /Oak Park Sourdough/i })
      ).toBeVisible();
    });
  });

  test.describe("Lands on the new Group page", () => {
    test("Given the walkthrough completes | When Maya is redirected | Then she lands on the place-scoped Group URL with founder+owner rendering and an empty Items section", async ({
      page,
    }) => {
      // Given + When — execute the walkthrough (reuses the Beat-2 flow shape)
      await signIn(page, MAYA.email, MAYA.password);
      await page.goto("/you");
      await page.getByRole("button", { name: /^Sell$/i }).click();
      await page
        .getByLabel(/Brand name/i)
        .fill("Oak Park Sourdough");
      await page.getByRole("button", { name: /Continue/i }).click();
      await page
        .getByRole("option", { name: new RegExp(MAYA.savedLocationName, "i") })
        .click();
      await page.getByRole("button", { name: /Continue/i }).click();
      await page
        .getByLabel(/About|Public description/i)
        .fill("Sourdough bread baked at home in Oak Park.");
      await page.getByRole("button", { name: /Continue/i }).click();
      await page.getByRole("link", { name: /Skip this step/i }).click();
      await page
        .getByRole("button", { name: /Create my (shop|business Group)/i })
        .click();

      // Then — URL shape per ADR-22 slug suffix
      // Why: per F036 scenario "lands on /p/[…place]/g/[slug-suffix] (slug derived
      // from display_name + random suffix per ADR-22)". The suffix protects against
      // brand-name collisions across cities. Strict regex enforces the ADR pattern.
      await expect(page).toHaveURL(/\/p\/.+\/g\/oak-park-sourdough(-[a-z0-9]+)?$/);

      // Then — page renders Maya as founder (byline shows her, no /m link yet)
      // Why: scenario Then-clause "page renders her as founder + owner". The merged
      // F035 Shop page (ShopPublicPage, data-testid="shop-founder") renders the
      // founder byline. Per T095 the link to /m/[handle] is gated on the founder's
      // discoverability: a Member created through this walkthrough is private-by-
      // default (is_discoverable=false), so her byline renders as plain text
      // (shop-founder-text) with NO /m link — existence surfaces, the personal
      // profile link only appears once she opts in. Assert the founder container +
      // the text byline, and that no /m/[handle] link is present.
      await expect(page.getByTestId("shop-founder")).toBeVisible();
      await expect(page.getByTestId("shop-founder-text")).toBeVisible();
      await expect(
        page.locator(`a[href="/m/${MAYA.handle}"]`)
      ).toHaveCount(0);

      // Then — empty Items section on the freshly-created Shop
      // Why: scenario Then-clause "empty Items section". The merged F035 page
      // renders the empty state (data-testid="shop-items-empty"). The owner-facing
      // "Add a product" CTA is membership-driven and lives on the seller index
      // /you/sell (T078/T080), not on the public Shop page — it is asserted in the
      // "Selling-tool affordances surface from Group membership" test below.
      await expect(page.getByTestId("shop-items-empty")).toBeVisible();
    });
  });

  test.describe("Selling-tool affordances surface from Group membership", () => {
    test("Given Maya has ≥1 active kind='business' Group membership | When she returns to /you | Then producer affordances appear from membership state, not from a profile toggle", async ({
      page,
    }) => {
      // Given — Maya already completed the walkthrough (use BAKER_RUTH-shaped seed
      // for a Member with an active kind='business' Group). This test verifies the
      // post-onboarding state, decoupled from the walkthrough flow itself.
      await signIn(page, BAKER_RUTH.email, BAKER_RUTH.password);

      // When — open the Sell CTA on /you. Per F036 branch 3, a Member with an
      // active business Group is routed to the seller index /you/sell. The routing
      // itself IS the membership-driven behavior: the CTA reads group_memberships
      // at query time (getDraftGroup → hasActiveBusinessGroup), no profile toggle.
      await page.goto("/you");
      await page.getByRole("button", { name: /^Sell$/i }).click();
      await expect(page).toHaveURL(/\/you\/sell$/);

      // Then — producer affordances visible (Add a product / service / gathering)
      // Why: per F036 scenario "selling-tool affordances … appear from her active
      // membership — no profile toggle. Per ADR-12 SUPERSEDED 2026-05-12." The
      // merged seller index (T078/T082/T084) renders one composer button per kind
      // for each active business Group. The gathering composer's accessible name is
      // "Host a gathering" (kind-specific verb per the naming-conventions table),
      // not "Add a gathering".
      await expect(
        page.getByRole("button", { name: /Add a product/i })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Add a service/i })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Host a gathering/i })
      ).toBeVisible();

      // And — no Maker-mode-style profile toggle anywhere on the page
      // Why: ADR-12 SUPERSEDED retires the maker_mode_enabled flag explicitly. If
      // a "Become a Maker" / "Producer mode" / "Maker mode" toggle reappears, the
      // refactor that removed the flag has been undone and the costume is back.
      await expect(
        page.getByRole("switch", { name: /Maker mode|Producer mode|Become a Maker/i })
      ).toHaveCount(0);
      await expect(
        page.getByRole("checkbox", { name: /Maker mode|Producer mode|Become a Maker/i })
      ).toHaveCount(0);
    });
  });

  test.describe("Locality step is skippable", () => {
    test("Given Maya skips the Tier 0 locality step | When the walkthrough completes | Then the Group is created without a member_business_jurisdictions row and no Locally Owned badge surfaces", async ({
      page,
    }) => {
      // Given — clean Maya, drive the walkthrough but skip the locality step
      await signIn(page, MAYA.email, MAYA.password);
      await page.goto("/you");
      await page.getByRole("button", { name: /^Sell$/i }).click();
      await page
        .getByLabel(/Brand name/i)
        .fill("Oak Park Sourdough");
      await page.getByRole("button", { name: /Continue/i }).click();
      await page
        .getByRole("option", { name: new RegExp(MAYA.savedLocationName, "i") })
        .click();
      await page.getByRole("button", { name: /Continue/i }).click();
      await page
        .getByLabel(/About|Public description/i)
        .fill("Sourdough bread baked at home in Oak Park.");
      await page.getByRole("button", { name: /Continue/i }).click();

      // Locality step must offer a Skip link (the only optional step in the recipe)
      // Why: per design-language.md Multi-step composer recipe "Skip this step (text
      // link, center, only on optional steps)" — the affordance must exist on
      // optional steps and only on optional steps. Its absence on step 4 here
      // would force ZIP entry, breaking F037's split of the claim lifecycle.
      const skipLink = page.getByRole("link", { name: /Skip this step/i });
      await expect(skipLink).toBeVisible();

      // When — Skip the locality step, then submit
      await skipLink.click();
      await page
        .getByRole("button", { name: /Create my (shop|business Group)/i })
        .click();

      // Then — landed on the Group page
      await expect(page).toHaveURL(/\/p\/.+\/g\/oak-park-sourdough(-[a-z0-9]+)?$/);

      // Then — no Locally Owned badge on the Group page
      // Why: F036 scenario "no badge surfaces on the Group page" when the Tier 0
      // step is skipped. F037 owns the badge lifecycle; F036 must NOT surface the
      // badge as a side effect of Group creation. Surfacing one here would mean the
      // badge condition (Tier 0 row exists OR proximity-true) has been weakened.
      await expect(
        page.getByText(/Locally Owned|Claimed local owner/i)
      ).toHaveCount(0);

      // Forward-dep (F037) — return path to the locality claim via Group settings.
      // The scenario's "she can return to the locality claim via Group settings
      // later" return-path is owned by F037 (Maya claims Locally Owned), still in
      // planning/backlog: the member_business_jurisdictions substrate and the
      // Shop-settings surface do not exist yet — the walkthrough discards the Tier 0
      // ZIP on submit (SellWalkthrough.tsx) and resolve-shop.ts notes the
      // jurisdictions table "does not exist yet". The Group-page settings
      // entry-point assertion is intentionally deferred until F037 ships the claim
      // lifecycle. The verifiable F036 contract — skippable Tier 0 step, no Locally
      // Owned badge when skipped — is asserted above.
    });
  });

  test.describe("Edge: anchor Location doesn't exist → inline add", () => {
    test("Given Maya has no saved Location matching her need | When she opens the anchor step and taps 'Add a new Location' | Then the sub-flow opens, saves a new Location, and returns to the walkthrough with that Location pre-selected", async ({
      page,
    }) => {
      // Given — a Maya-shaped Member with NO existing Locations (a separate seed)
      await signIn(page, MAYA.email, MAYA.password);
      await page.goto("/you");
      await page.getByRole("button", { name: /^Sell$/i }).click();
      await page
        .getByLabel(/Brand name/i)
        .fill("Oak Park Sourdough");
      await page.getByRole("button", { name: /Continue/i }).click();

      // When — anchor step shows "+ Add a new Location" at the bottom of the picker
      // Why: per design-language.md "Add new entity inside a composer" pattern, the
      // "+ Add" row sits at the BOTTOM of the result list, never at the top —
      // default path is "pick existing". An "+ Add" row floating to the top would
      // signal that "create new" is the expected default, which it isn't.
      const addRow = page.getByRole("button", { name: /Add a new Location/i });
      await expect(addRow).toBeVisible();
      await addRow.click();

      // Then — secondary drawer opens with a single-form "Add a Location" UI
      await expect(
        page.getByRole("heading", { name: /Add a Location/i })
      ).toBeVisible();

      // Fill the new-Location form
      await page
        .getByLabel(/Location name|Name/i)
        .fill("Oak Park Home Kitchen");
      // (additional fields per the Location create handler; build agent fills in
      // the form shape from location.create's contract)
      await page
        .getByRole("button", { name: /Add and select/i })
        .click();

      // Then — return to the parent composer at the anchor step, new Location selected
      // Why: per "Add new entity inside a composer" — on save, "returns to the
      // parent composer's picker step with the new entity pre-selected. The
      // parent composer's step indicator does not advance — the Member still
      // needs to tap Continue to commit the picker choice and move forward."
      await expect(
        page.getByRole("heading", { name: /Add a Location/i })
      ).not.toBeVisible();
      await expect(
        page.getByText(/Oak Park Home Kitchen/i)
      ).toBeVisible();
      // Step indicator should still be on step 2 (the anchor step)
      await expect(
        page.getByRole("progressbar")
      ).toHaveAttribute("aria-valuenow", "2");
    });
  });

  test.describe("Edge: walkthrough abandoned mid-flow → resume on next /you visit", () => {
    test("Given Maya completes step 1 and closes the drawer | When she returns to /you | Then the Sell CTA label flips to a continue-affordance and tapping it resumes at the next step with prior fields preserved", async ({
      page,
    }) => {
      // Given — fresh Maya, open walkthrough, fill step 1, close
      await signIn(page, MAYA.email, MAYA.password);
      await page.goto("/you");
      await page.getByRole("button", { name: /^Sell$/i }).click();
      await page
        .getByLabel(/Brand name/i)
        .fill("Oak Park Sourdough");
      await page.getByRole("button", { name: /Continue/i }).click();
      // Close the composer via the X button (top-right per recipe)
      await page.getByRole("button", { name: /Close|Dismiss/i }).click();

      // When — return to /you
      await page.goto("/you");

      // Then — CTA label flips to a continue-affordance
      // Why: per design-language.md Multi-step composer "the originating CTA's
      // label flips to 'Continue setting up your shop' (or the kind-specific
      // equivalent) when a draft exists." If the label stays at "Sell", the
      // resume-detection has regressed and Maya might re-create a second draft on
      // the next tap.
      const continueCta = page.getByRole("button", {
        name: /Continue setting up|Resume|Finish setting up/i,
      });
      await expect(continueCta).toBeVisible();

      // When — tap to resume
      await continueCta.click();

      // Then — composer opens at step 2 (anchor Location), brand name preserved
      // Why: per recipe "Re-entering the composer … resumes at the last step they
      // were on, with all prior fields populated from the substrate." Resuming at
      // step 1 (or losing the brand-name input) would defeat the partial-state
      // contract — the entire point is that the Member doesn't redo work.
      await expect(
        page.getByRole("progressbar")
      ).toHaveAttribute("aria-valuenow", "2");
    });
  });

  test.describe("Edge: Member already has a business Group → Sell routes to Add an Item picker, not the walkthrough", () => {
    test("Given Ruth has an active kind='business' Group | When she taps Sell | Then she is routed to an Add-an-Item picker, not into the kind='business' Group walkthrough", async ({
      page,
    }) => {
      // Given
      await signIn(page, BAKER_RUTH.email, BAKER_RUTH.password);
      await page.goto("/you");

      // When
      await page.getByRole("button", { name: /^Sell$/i }).click();

      // Then — no Brand-name step (which is the walkthrough's step 1)
      // Why: per F036 scenario "for Members with ≥1 active kind='business' Group,
      // those CTAs route to 'Add an Item' instead." Falling through to the
      // walkthrough would create a redundant duplicate Group and break the
      // multi-business-Group b2 deferral.
      await expect(
        page.getByRole("heading", { name: /Brand name/i })
      ).not.toBeVisible();

      // And — an Add-an-Item picker / shop dashboard surface IS visible
      await expect(
        page.getByText(
          new RegExp(BAKER_RUTH.existingBusinessGroupName, "i")
        )
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Add a product|Add an item/i })
      ).toBeVisible();
    });
  });
});
