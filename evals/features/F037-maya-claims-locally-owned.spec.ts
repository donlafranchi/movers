import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import {
  seedF037Fixture,
  resetJurisdiction,
  MAYA,
  ROSA,
  SHOP,
  PROXIMAL_ZIP,
  PROXIMAL_ZIP_2,
  NON_PROXIMAL_ZIP,
  type SeededF037Fixture,
} from "../fixtures/F037-claim";

// F037: Maya claims Locally Owned (Tier 0 self-attested ZIP lifecycle).
// Source: planning/now/scenario-F037-maya-claims-locally-owned.md
//
// The claim widget is an owner-only management surface; the badge it controls
// renders on the public Shop page (F035 beat 2). Every beat mutates Maya's one
// (member, group) active jurisdiction row, guarded by a unique partial index —
// so the suite runs SERIAL with a per-test reset (same pattern as F036).

let SEEDED: SeededF037Fixture;

test.beforeAll(async () => {
  SEEDED = await seedF037Fixture();
});

test.beforeEach(async () => {
  await resetJurisdiction(SEEDED.maya.memberId, SEEDED.groupId);
});

test.describe.configure({ mode: "serial" });

test.describe("F037 — Maya claims Locally Owned", () => {
  test("Beat 1 — owner sees the claim widget; anon does not", async ({ page }) => {
    // Anonymous viewer: public surface only, no owner widget.
    // Why: per business-jurisdiction.md T1 § Surfaces, claim management is
    // owner-gated — a non-owner must never see edit affordances.
    await page.goto(SHOP.url);
    await expect(page.getByTestId("claim-widget")).toHaveCount(0);
    await expect(page.getByTestId("claim-add")).toHaveCount(0);

    // Owner viewer: widget renders in its empty state.
    await signIn(page, MAYA.email, MAYA.password);
    await page.goto(SHOP.url);
    await expect(page.getByTestId("claim-widget")).toBeVisible();
    await expect(page.getByTestId("claim-add")).toBeVisible();
  });

  test("Beat 2 — Maya adds her ZIP and the badge appears", async ({ page }) => {
    await signIn(page, MAYA.email, MAYA.password);
    await page.goto(SHOP.url);

    // Empty state → no public badge yet.
    await expect(page.getByTestId("local-owner-badge")).toHaveCount(0);

    await page.getByTestId("claim-add").click();
    await page.getByTestId("claim-zip-input").fill(PROXIMAL_ZIP);
    await page.getByTestId("claim-submit").click();

    // Widget re-renders to the claimed state…
    await expect(page.getByText(new RegExp(`ZIP on file: ${PROXIMAL_ZIP}`, "i"))).toBeVisible();
    await expect(page.getByTestId("claim-edit")).toBeVisible();
    // …and the public badge now displays (F035 beat 2 lights up).
    await expect(page.getByTestId("local-owner-badge")).toHaveText("Claimed local owner");
  });

  test("Beat 3 — Maya edits her ZIP; the badge persists", async ({ page }) => {
    // Precondition: an existing proximal claim.
    await signIn(page, MAYA.email, MAYA.password);
    await page.goto(SHOP.url);
    await page.getByTestId("claim-add").click();
    await page.getByTestId("claim-zip-input").fill(PROXIMAL_ZIP);
    await page.getByTestId("claim-submit").click();
    await expect(page.getByTestId("local-owner-badge")).toBeVisible();

    // Edit to a second proximal ZIP — badge persists (still MSA 40900).
    await page.getByTestId("claim-edit").click();
    await page.getByTestId("claim-zip-input").fill(PROXIMAL_ZIP_2);
    await page.getByTestId("claim-submit").click();
    await expect(page.getByText(new RegExp(`ZIP on file: ${PROXIMAL_ZIP_2}`, "i"))).toBeVisible();
    await expect(page.getByTestId("local-owner-badge")).toHaveText("Claimed local owner");
  });

  test("Beat 4 — Maya removes her claim; the badge disappears", async ({ page }) => {
    await signIn(page, MAYA.email, MAYA.password);
    await page.goto(SHOP.url);
    await page.getByTestId("claim-add").click();
    await page.getByTestId("claim-zip-input").fill(PROXIMAL_ZIP);
    await page.getByTestId("claim-submit").click();
    await expect(page.getByTestId("local-owner-badge")).toBeVisible();

    await page.getByTestId("claim-remove").click();
    await page.getByTestId("claim-remove-confirm").click();

    // Back to empty state; public badge gone.
    await expect(page.getByTestId("claim-add")).toBeVisible();
    await expect(page.getByTestId("local-owner-badge")).toHaveCount(0);
  });

  test("Beat 5 — non-proximal ZIP is accepted but earns honest feedback, no badge", async ({
    page,
  }) => {
    await signIn(page, MAYA.email, MAYA.password);
    await page.goto(SHOP.url);
    await page.getByTestId("claim-add").click();
    await page.getByTestId("claim-zip-input").fill(NON_PROXIMAL_ZIP);
    await page.getByTestId("claim-submit").click();

    // The platform does NOT reject the claim — it reports proximity honestly.
    // Why: per groups.md line 323 the proximity test is a render-time
    // derivation, not a validation; the widget tells the owner why the badge
    // isn't surfacing without moralizing about the claim.
    const warn = page.getByTestId("claim-not-proximal");
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(/isn't in proximity/i);
    await expect(page.getByTestId("local-owner-badge")).toHaveCount(0);
  });

  test("Beat 6 — a non-owner cannot access the management surface", async ({ page }) => {
    await signIn(page, ROSA.email, ROSA.password);
    await page.goto(SHOP.url);
    await expect(page.getByTestId("shop-name")).toBeVisible();
    await expect(page.getByTestId("claim-widget")).toHaveCount(0);
    await expect(page.getByTestId("claim-add")).toHaveCount(0);
    await expect(page.getByTestId("claim-edit")).toHaveCount(0);
  });

  test("Edge — a non-5-digit ZIP is rejected inline, no row written", async ({ page }) => {
    await signIn(page, MAYA.email, MAYA.password);
    await page.goto(SHOP.url);
    await page.getByTestId("claim-add").click();
    await page.getByTestId("claim-zip-input").fill("999");
    await page.getByTestId("claim-submit").click();

    await expect(page.getByTestId("claim-zip-error")).toBeVisible();
    // No claim was persisted — reload shows the empty state, no badge.
    await page.reload();
    await expect(page.getByTestId("claim-add")).toBeVisible();
    await expect(page.getByTestId("local-owner-badge")).toHaveCount(0);
  });
});
