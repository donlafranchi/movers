import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { signIn } from "../helpers/auth";
import { seedF038Fixture, MAYA, type SeededF038Fixture } from "../fixtures/F038-product";
import { seedF040Fixture, TOMAS, type SeededF040Fixture } from "../fixtures/F040-service";

// F041: A producer generates a QR card for their item
// Source: planning/now/scenario-F041-producer-generates-qr-card.md
//
// Reuses the F038 (product) + F040 (service) seeds — published Items owned by a
// signed-in producer — and verifies the owner-only "Get a QR card" affordance:
//   - owner sees the button on their published Item page (product + service)
//   - anonymous / non-owner viewers do NOT
//   - clicking it downloads a print-quality PNG (server-side generation via the
//     item.qr_card.request handler, T093)
//
// PNG dimensions (≥1200px = 4in @ 300 DPI) and canonical-URL encoding are
// verified at the lib/handler layer by the T093 vitest suite; this eval proves
// the surface contract end-to-end (the download is a real PNG).

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let PRODUCTS: SeededF038Fixture;
let SERVICES: SeededF040Fixture;
test.beforeAll(async () => {
  PRODUCTS = await seedF038Fixture();
  SERVICES = await seedF040Fixture();
});

test.describe("F041 — A producer generates a QR card for their item", () => {
  test.describe("Beat 1 — Owner sees 'Get a QR card' on their published product", () => {
    test("Given Maya owns a published product and is signed in | When she loads its page | Then the QR-card affordance is visible", async ({
      page,
    }) => {
      await signIn(page, MAYA.email, MAYA.password);
      const res = await page.goto(PRODUCTS.paidGroup.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("qr-card-button")).toBeVisible();
    });
  });

  test.describe("Beat 2 — Anonymous viewer does NOT see the affordance", () => {
    test("Given an anonymous viewer | When they load the same published product | Then no QR-card affordance renders (owner-only)", async ({
      page,
    }) => {
      const res = await page.goto(PRODUCTS.paidGroup.url);
      expect(res?.status()).toBe(200);
      // The product itself renders (public surface)…
      await expect(page.getByTestId("product-title")).toBeVisible();
      // …but the owner-only QR affordance does not.
      await expect(page.getByTestId("qr-card-button")).toHaveCount(0);
    });
  });

  test.describe("Beat 3 — Clicking downloads a print-quality PNG", () => {
    test("Given the signed-in owner on her product page | When she taps 'Get a QR card' | Then a .png file downloads whose bytes are a valid PNG", async ({
      page,
    }) => {
      await signIn(page, MAYA.email, MAYA.password);
      const res = await page.goto(PRODUCTS.individual.url);
      expect(res?.status()).toBe(200);

      const downloadPromise = page.waitForEvent("download");
      await page.getByTestId("qr-card-button").click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toMatch(/\.png$/);
      const path = await download.path();
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    });
  });

  test.describe("Beat 4 — Works across Item kinds (service)", () => {
    test("Given Tomás owns a published service and is signed in | When he loads its page | Then the QR-card affordance is visible", async ({
      page,
    }) => {
      await signIn(page, TOMAS.email, TOMAS.password);
      const res = await page.goto(SERVICES.paidGroup.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("qr-card-button")).toBeVisible();
    });
  });
});
