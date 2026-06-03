// T079 — Public product Item page (F038).
// Spec:   planning/now/scenario-F038-producer-lists-product.md § Item page shows
//         brand resolve-up + owner; § Skip-provenance path.
//
// Server component (presentational). Renders title, description, price (or
// "Free"), photo, pickup point, brand resolve-up (links to the Group page),
// and the owner Member (links to /m/<handle>). The Locally Made badge slot is
// present but renders nothing when madeAtPlaceId is null — F038 skip-path;
// F039 lands the claim + populates the badge.

import Link from 'next/link'
import { MapPin } from 'lucide-react'
import type { ResolvedProduct } from '@/lib/items/resolve-product'
import { QrCardButton } from './QrCardButton'

export interface ProductPublicPageProps {
  product: ResolvedProduct
  /** Group page href when filed under a business Group; null when individual. */
  groupHref: string | null
  /** True when the signed-in viewer owns this Item — gates the QR-card affordance (F041). */
  isOwner?: boolean
}

function formatPrice(cents: number | null, unit: string | null): string {
  if (cents === null) return 'Free'
  const dollars = (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  return unit ? `${dollars} / ${unit}` : dollars
}

export function ProductPublicPage({ product, groupHref, isOwner = false }: ProductPublicPageProps) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6" data-testid="product-page">
      <article>
        {product.photoUrls.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.photoUrls[0]}
            alt={product.title}
            data-testid="product-photo"
            className="w-full rounded-2xl object-cover"
          />
        ) : null}

        <h1
          className="mt-4 text-2xl font-semibold leading-tight"
          data-testid="product-title"
        >
          {product.title}
        </h1>

        <p className="mt-2 text-xl font-medium" data-testid="product-price">
          {formatPrice(product.priceCents, product.priceUnit)}
        </p>

        {/* Brand resolve-up — links to the Group page when filed. */}
        {product.brandLabel ? (
          groupHref ? (
            <Link
              href={groupHref}
              data-testid="product-brand-link"
              className="mt-3 inline-block text-sm font-medium text-[--color-accent] hover:underline"
            >
              {product.brandLabel}
            </Link>
          ) : (
            <p data-testid="product-brand" className="mt-3 text-sm font-medium">
              {product.brandLabel}
            </p>
          )
        ) : null}

        {/* Locally Made badge slot — empty when madeAtPlaceId is null (F038
            skip-path). F039 populates this. */}
        {product.madeAtPlaceId ? (
          <span
            data-testid="product-made-badge"
            className="ml-2 mt-3 inline-flex items-center rounded-full bg-[--color-accent-tint] px-2 py-0.5 text-xs font-medium text-[--color-accent]"
          >
            Locally Made
          </span>
        ) : null}

        {product.description ? (
          <p
            className="mt-4 whitespace-pre-line text-[--color-fg]"
            data-testid="product-description"
          >
            {product.description}
          </p>
        ) : null}

        {product.pickup ? (
          <section
            className="mt-6 rounded-xl border border-neutral-200 p-4"
            data-testid="product-pickup"
          >
            <h2 className="text-sm font-semibold text-[--color-fg]">Pickup point</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[--color-fg-muted]">
              <MapPin size={16} aria-hidden="true" />
              {product.pickup.label}
            </p>
          </section>
        ) : null}

        <p className="mt-6 text-sm text-[--color-fg-muted]">
          Sold by{' '}
          <Link
            href={`/m/${product.owner.handle}`}
            data-testid="product-owner-link"
            className="font-medium text-[--color-accent] hover:underline"
          >
            {product.owner.displayName}
          </Link>
        </p>

        {isOwner ? (
          <div className="mt-6">
            <QrCardButton itemId={product.itemId} />
          </div>
        ) : null}
      </article>
    </main>
  )
}
