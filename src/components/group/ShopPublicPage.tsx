// T074 — Public Shop page presentational component (F035 read surface).
// Spec: planning/now/scenario-F035-rosa-finds-mayas-shop.md story beats 1–6.
//
// Presentational + server-renderable. Data fetching lives in the route
// (src/app/p/[...slug]/page.tsx); this component renders the resolved shape so
// it stays unit-testable. The only client island is <FollowShopButton>.

import type { ResolvedShop, ShopItem, LocalOwnerBadge, OwnerClaim } from '@/lib/groups/resolve-shop'
import { FollowShopButton } from './FollowShopButton'
import { LocallyOwnedClaim } from './LocallyOwnedClaim'
import { setJurisdictionAction, removeJurisdictionAction } from '@/app/p/[...slug]/claim-actions'

interface Props {
  shop: ResolvedShop
  badge: LocalOwnerBadge | null
  items: ShopItem[]
  loggedIn: boolean
  /** T097 (F037) — the acting owner's claim state; null for non-owners / anon
   *  (the owner-only management widget renders only when this is non-null). */
  ownerClaim?: OwnerClaim | null
}

export function ShopPublicPage({ shop, badge, items, loggedIn, ownerClaim = null }: Props) {
  const isDraftPreview = shop.lifecycleState === 'draft'

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {isDraftPreview && (
        <div
          data-testid="shop-draft-banner"
          role="status"
          className="mb-6 rounded border border-dashed border-gray-400 bg-gray-50 p-4 text-sm text-gray-700"
        >
          <p className="font-medium">Draft — not yet public.</p>
          <p className="mt-1">
            Only you can see this. <a href="/you/sell" className="underline">Resume walkthrough</a> to
            finish setting up your Shop.
          </p>
        </div>
      )}

      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 data-testid="shop-name" className="text-2xl font-semibold">
            {shop.displayName}
          </h1>
          {badge && (
            <span
              data-testid="local-owner-badge"
              className="chip chip-selected whitespace-nowrap text-xs"
            >
              {badge.label}
            </span>
          )}
        </div>

        {shop.founder && (
          <div data-testid="shop-founder" className="flex items-center gap-2">
            {/* T095 — link only when the founder has opted into discoverability;
                otherwise render the name as plain text. The Shop is public regardless
                (Groups are public-by-default); only the personal-profile link is gated. */}
            {shop.founder.isDiscoverable ? (
              <a
                href={`/m/${shop.founder.handle}`}
                data-testid="shop-founder-link"
                className="flex items-center gap-2"
              >
                {shop.founder.avatarUrl && (
                  // Decorative: the adjacent name text labels the link.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shop.founder.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                )}
                <span className="text-sm text-gray-700">{shop.founder.displayName}</span>
              </a>
            ) : (
              <span
                data-testid="shop-founder-text"
                className="flex items-center gap-2"
              >
                {shop.founder.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shop.founder.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                )}
                <span className="text-sm text-gray-700">{shop.founder.displayName}</span>
              </span>
            )}
          </div>
        )}

        {shop.publicDescription && (
          <p className="text-sm text-gray-600">{shop.publicDescription}</p>
        )}

        <div className="mt-2">
          <FollowShopButton loggedIn={loggedIn} shopName={shop.displayName} />
        </div>
      </header>

      {/* F037 — owner-only Locally Owned claim management. Rendered only when the
          viewer is an active owner (ownerClaim resolved non-null); non-owners and
          anon never see it. */}
      {ownerClaim && (
        <LocallyOwnedClaim
          groupId={shop.groupId}
          claim={ownerClaim}
          onSet={setJurisdictionAction}
          onRemove={removeJurisdictionAction}
        />
      )}

      <section className="mt-8">
        <h2 className="text-lg font-medium">Products &amp; services</h2>
        {items.length === 0 ? (
          <div
            data-testid="shop-items-empty"
            className="mt-3 rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500"
          >
            <p className="font-medium text-gray-600">Nothing listed yet</p>
            <p className="mt-1">
              {shop.founder?.displayName ?? 'This Shop'} hasn&apos;t listed anything yet — check
              back soon.
            </p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="card p-3 text-sm">
                {item.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
