import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import {
  seedF035Fixture,
  MAYA,
  ROSA,
  SHOP,
  DRAFT_SHOP,
  type SeededF035Fixture,
} from "../fixtures/F035-shop";

// F035: Rosa finds Maya's Shop
// Source: planning/now/scenario-F035-rosa-finds-mayas-shop.md
//
// One test per Given/When/Then acceptance beat. The Shop is a read-only surface,
// so most beats are pure navigation + render assertions. Two beats carry
// forward-deps the scenario itself flags as deferrable:
//   - Beat 2 ("Claimed local owner" badge) — needs member_business_jurisdictions
//     + zip_is_proximal_to_location() (F037 / S-jurisdictions, not yet shipped).
//     Only the NEGATIVE branch (badge absent) is testable now.
//   - Beat 4 (follow persistence) — member_follows is member→member only; the
//     group-follow write is assigned to F042. The CTA affordance + copy is
//     testable now; the persisted follow is not.

let SEEDED: SeededF035Fixture;
test.beforeAll(async () => {
  SEEDED = await seedF035Fixture();
});
// F035 seeds read-only state once and never mutates it in-test, so no
// per-test reset is needed (unlike F036's draft-resetting beforeEach).
void (() => SEEDED);

test.describe("F035 — Rosa finds Maya's Shop", () => {
  test.describe("Beat 1 — Page loads and renders the Shop header", () => {
    test("Given an active Shop at its public URL | When a viewer navigates to it | Then the brand name, founder link, and description render", async ({
      page,
    }) => {
      // When — anonymous navigation (the surface is anonymous-readable per beat 5)
      const res = await page.goto(SHOP.url);

      // Then — the page loads (no 401/302 gate on the public surface)
      // Why: scenario beat 5 — "the page would still render fully — the public
      // surface is anonymous-readable." A non-200 here means the read surface
      // has been gated behind auth, breaking the share-URL promise.
      expect(res?.status()).toBe(200);

      // Then — brand-label heading sourced from group_businesses.display_name
      // Why: scenario beat 1 Why — per groups.md line 260 the brand-label
      // precedence rule says group_businesses.display_name wins over the
      // anchor Location's brand_label. The <h1> must be the Group's display_name.
      await expect(page.getByTestId("shop-name")).toHaveText(SHOP.brandName);

      // Then — founder Member name + link to /m/{handle}
      // Why: scenario beat 1 Why — per groups.md § No-personhood guarantees, the
      // Group surface keeps a named human visible as load-bearing accountability.
      // The founder link is the structural commitment to person-anchoring; the
      // link target must resolve to the founder's Member page.
      const founder = page.getByTestId("shop-founder");
      await expect(founder).toContainText(MAYA.displayName);
      await expect(founder.getByRole("link")).toHaveAttribute(
        "href",
        `/m/${MAYA.handle}`,
      );

      // Then — brand description renders when set
      // Why: scenario beat 1 — "A short brand description if Maya set one … ;
      // absent gracefully if not." The seeded Shop sets one, so it must surface.
      await expect(page.getByText(SHOP.publicDescription)).toBeVisible();
    });
  });

  test.describe("Beat 2 — 'Claimed local owner' badge (forward-dep on F037)", () => {
    test("Given no jurisdiction substrate exists yet | When the page renders | Then the local-owner badge does NOT render and leaves no negative space", async ({
      page,
    }) => {
      await page.goto(SHOP.url);

      // Then — no badge (the only testable branch until S-jurisdictions ships)
      // Why: scenario beat 2 second clause — "the badge does NOT render — the
      // surface remains clean, no 'not locally owned' negative space." Per the
      // T074 scope note, resolveLocalOwnerBadge returns null until F037 lands
      // member_business_jurisdictions + zip_is_proximal_to_location(). If a badge
      // appears here, the render-path guard has been wired to a false positive.
      await expect(page.getByTestId("local-owner-badge")).toHaveCount(0);
      await expect(
        page.getByText(/locally owned|not locally owned/i),
      ).toHaveCount(0);
    });
  });

  test.describe("Beat 3 — Items section renders empty-state", () => {
    test("Given no published items exist for this Shop | When the page renders | Then a visible empty-state shows instead of a hidden section", async ({
      page,
    }) => {
      await page.goto(SHOP.url);

      // Then — visible-but-empty Items section
      // Why: scenario beat 3 Why — "visible-but-empty signals 'Shop is real,
      // products will come' — hidden signals 'this is a half-built page.'" The
      // empty-state element must be present (not omitted) until F038/F040 light
      // up real Items.
      const empty = page.getByTestId("shop-items-empty");
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(
        /hasn['’]t listed anything yet — check back soon/i,
      );
    });
  });

  test.describe("Beat 4 — Logged-in viewer sees the Follow CTA", () => {
    test("Given Rosa is logged in and not following | When the page renders | Then a 'Follow {Shop}' button shows; tapping it is non-destructive (persistence deferred to F042)", async ({
      page,
    }) => {
      // Given — Rosa (a logged-in viewer who is NOT the owner)
      await signIn(page, ROSA.email, ROSA.password);

      // When
      await page.goto(SHOP.url);

      // Then — "Follow {Shop name}" CTA for logged-in viewers
      // Why: scenario beat 4 Why — per member.md § Follows substrate, follow is
      // the standing form of "tell me when this Shop has news." The button label
      // must name the Shop so the action is unambiguous.
      const followBtn = page.getByTestId("follow-shop");
      await expect(followBtn).toBeVisible();
      await expect(followBtn).toHaveText(new RegExp(`Follow ${SHOP.brandName}`, "i"));

      // When Rosa taps Follow → non-destructive affordance (write deferred)
      // Why: T074 scope note — group-follow persistence is assigned to F042
      // (member_follows is member→member only). The tap must NOT error or
      // navigate away; it surfaces a coming-soon status. When F042 lands the
      // write, this assertion flips to "Following" — escalate to scope, don't
      // silently weaken it.
      await followBtn.click();
      await expect(page.getByRole("status")).toContainText(/coming soon/i);
    });
  });

  test.describe("Beat 5 — Anonymous viewer sees the page minus follow persistence", () => {
    test("Given Rosa is not logged in | When the page renders | Then the page renders fully and the Follow CTA becomes 'Sign up to follow' routing to signup", async ({
      page,
    }) => {
      // When — no sign-in
      const res = await page.goto(SHOP.url);

      // Then — full render for anon (no 401/302)
      // Why: scenario beat 5 Why — per policy.md's opt-out posture, public Group
      // pages are publicly readable; gating happens only at the write moment.
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("shop-name")).toHaveText(SHOP.brandName);

      // Then — Follow CTA copy changes to a signup route
      // Why: scenario beat 5 — "the Follow CTA reads 'Sign up to follow' and
      // routes through the signup flow before persisting the follow." The
      // logged-in follow button must NOT be present for anon viewers.
      const signup = page.getByTestId("follow-shop-signup");
      await expect(signup).toBeVisible();
      await expect(signup).toHaveText(/sign up to follow/i);
      await expect(signup).toHaveAttribute("href", "/auth/signup");
      await expect(page.getByTestId("follow-shop")).toHaveCount(0);
    });
  });

  test.describe("Beat 6 — Draft Groups 404 to non-owners; preview to the owner", () => {
    test("Given a draft Shop | When an anonymous viewer navigates to its URL | Then the page returns 404", async ({
      page,
    }) => {
      // When — anon hits the draft URL
      const res = await page.goto(DRAFT_SHOP.url);

      // Then — 404
      // Why: scenario beat 6 — "the page returns 404 (per the RLS policy
      // groups_select_active_or_own_draft from T070)." RLS returns no row for a
      // non-founder viewing a draft → resolveShop null → notFound(). A 200 here
      // means a half-finished surface is leaking publicly.
      expect(res?.status()).toBe(404);
    });

    test("Given a draft Shop | When a logged-in NON-owner navigates to its URL | Then the page returns 404", async ({
      page,
    }) => {
      // Given — Rosa is logged in but is not the founder
      await signIn(page, ROSA.email, ROSA.password);

      // When
      const res = await page.goto(DRAFT_SHOP.url);

      // Then — 404 (RLS keys the draft carve-out on founder_member_id = auth.uid())
      // Why: scenario beat 6 — non-owners "see the page as if the Group doesn't
      // exist." Being logged in as someone else must not unlock the draft.
      expect(res?.status()).toBe(404);
    });

    test("Given a draft Shop | When the founder (Maya) navigates to its URL | Then a draft preview renders with a banner and a Resume walkthrough link", async ({
      page,
    }) => {
      // Given — Maya, the founder, is logged in
      await signIn(page, MAYA.email, MAYA.password);

      // When
      const res = await page.goto(DRAFT_SHOP.url);

      // Then — the founder sees the draft (not a 404)
      // Why: scenario beat 6 — "draft Groups are owner-visible so Maya can
      // preview her own work-in-progress." The RLS founder carve-out returns the
      // row, so lifecycleState='draft' ⟹ render the owner preview.
      expect(res?.status()).toBe(200);

      const banner = page.getByTestId("shop-draft-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/draft — not yet public/i);

      // Then — a "Resume walkthrough" affordance back into the Sell flow
      // Why: scenario beat 6 — the draft preview carries a "Resume walkthrough"
      // CTA so the owner can finish setup. Its absence would orphan the draft.
      await expect(
        banner.getByRole("link", { name: /resume walkthrough/i }),
      ).toHaveAttribute("href", "/you/sell");
    });
  });
});
