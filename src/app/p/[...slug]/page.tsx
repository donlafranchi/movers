// T060 — Place-scoped URL catch-all.
//
// Spec: product/systems/places.md § URL-prefix derivation;
//       ADR-20 § URL hierarchy;
//       ADR-0022 § Trade-offs (county tier is URL-skippable; state slug = USPS code).
//
// This catch-all handles bare place URLs at b1.x:
//   /p/ca                                  — California (state)
//   /p/ca/sacramento                       — Sacramento (city; county skipped)
//   /p/ca/sacramento/oak-park              — Oak Park (neighborhood)
//   /p/ca/yolo                             — Yolo County (no city → falls
//                                            through to county tier)
//   /p/ca/west-sacramento                  — West Sacramento (city under
//                                            Yolo County; county skipped)
//
// b1.1+ structural constraint (flagged in DEVIATIONS § T060): Next.js
// App Router does NOT allow a static segment after a catch-all
// (`app/p/[...slug]/g/[id]/page.tsx` is rejected). When Groups, Locations,
// and Items need to nest under `/p/<place>/g/<group>`, the dispatch will
// have to fold into THIS file — inspect the segments for `/g/`, `/l/`, or
// inner `/p/` markers and render the appropriate view. ADR-20 did not
// anticipate the Next.js limit; revisit before the b1.1 Group surface work.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { resolvePlacePath } from '@/lib/places/resolve-path'
import { PlaceBreadcrumb } from '@/components/place-breadcrumb'
import {
  splitGroupSlug,
  resolveShop,
  resolveShopItems,
  resolveLocalOwnerBadge,
} from '@/lib/groups/resolve-shop'
import { ShopPublicPage } from '@/components/group/ShopPublicPage'
import { splitItemSlug, resolveProduct } from '@/lib/items/resolve-product'
import { ProductPublicPage } from '@/components/item/ProductPublicPage'
import { splitServiceSlug, resolveService } from '@/lib/items/resolve-service'
import { ServicePublicPage } from '@/components/item/ServicePublicPage'

interface Props {
  params: Promise<{ slug: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()

  // Product Item page — /p/[…place]/g/[group]/p/[item]. Checked before the
  // Group split (which would otherwise match the group segment and ignore the
  // trailing /p/<item>). Per T060 DEVIATION, all nested dispatch folds here.
  const itemSplit = splitItemSlug(slug)
  if (itemSplit) {
    const product = await resolveProduct(supabase, {
      groupSlug: itemSplit.groupSlug,
      itemSlug: itemSplit.itemSlug,
    })
    if (!product) {
      return { title: 'Not found — Movers, Makers & Shakers' }
    }
    return {
      title: `${product.title} — Movers, Makers & Shakers`,
      description:
        product.description ||
        `${product.title}${product.brandLabel ? ` from ${product.brandLabel}` : ''}.`,
    }
  }

  // Service Item page — /p/[…place]/g/[group]/s/[item]. Like the product
  // dispatch, checked before the Group split (the `/s/` marker distinguishes
  // it from product `/p/` and the bare Shop page).
  const serviceSplit = splitServiceSlug(slug)
  if (serviceSplit) {
    const service = await resolveService(supabase, {
      groupSlug: serviceSplit.groupSlug,
      itemSlug: serviceSplit.itemSlug,
    })
    if (!service) {
      return { title: 'Not found — Movers, Makers & Shakers' }
    }
    return {
      title: `${service.title} — Movers, Makers & Shakers`,
      description:
        service.description ||
        `${service.title}${service.brandLabel ? ` from ${service.brandLabel}` : ''}.`,
    }
  }

  // Group (Shop) page — /p/[…place]/g/[slug]. Per T060 DEVIATION, the Group
  // dispatch folds into this catch-all (Next.js forbids a static segment after
  // a catch-all).
  const groupSplit = splitGroupSlug(slug)
  if (groupSplit) {
    const shop = await resolveShop(supabase, groupSplit.groupSlug)
    if (!shop) {
      return { title: 'Not found — Movers, Makers & Shakers' }
    }
    return {
      title: `${shop.displayName} — Movers, Makers & Shakers`,
      description:
        shop.publicDescription || `${shop.displayName} on Movers, Makers & Shakers.`,
    }
  }

  const resolved = await resolvePlacePath(supabase, slug)
  if (!resolved) {
    return { title: 'Place not found — Movers, Makers & Shakers' }
  }
  const rootDisplay = resolved.ancestors[0]?.display_name ?? resolved.place.display_name
  return {
    title:
      resolved.ancestors.length === 0
        ? `${resolved.place.display_name} — Movers, Makers & Shakers`
        : `${resolved.place.display_name} — ${rootDisplay}`,
    description: `Browse what's happening in ${resolved.place.display_name}.`,
  }
}

export default async function PlacePage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  // Product Item page dispatch — /p/[…place]/g/[group]/p/[item]. Checked before
  // the Group split. RLS (items_select_published) is the visibility gate.
  const itemSplit = splitItemSlug(slug)
  if (itemSplit) {
    const product = await resolveProduct(supabase, {
      groupSlug: itemSplit.groupSlug,
      itemSlug: itemSplit.itemSlug,
    })
    if (!product) {
      notFound()
    }
    const groupHref = `/p/${itemSplit.placeSegments.join('/')}/g/${itemSplit.groupSlug}`
    return <ProductPublicPage product={product} groupHref={groupHref} />
  }

  // Service Item page dispatch — /p/[…place]/g/[group]/s/[item]. Checked before
  // the Group split. RLS (items_select_published) is the visibility gate.
  const serviceSplit = splitServiceSlug(slug)
  if (serviceSplit) {
    const service = await resolveService(supabase, {
      groupSlug: serviceSplit.groupSlug,
      itemSlug: serviceSplit.itemSlug,
    })
    if (!service) {
      notFound()
    }
    const groupHref = `/p/${serviceSplit.placeSegments.join('/')}/g/${serviceSplit.groupSlug}`
    return <ServicePublicPage service={service} groupHref={groupHref} />
  }

  // Group (Shop) page dispatch — see generateMetadata comment + T060 DEVIATION.
  const groupSplit = splitGroupSlug(slug)
  if (groupSplit) {
    // RLS (T070 groups_select_active_or_own_draft) is the visibility gate:
    // a draft / dissolved / nonexistent slug yields no row → 404 to non-owners;
    // a returned 'draft' row implies the viewer is the founder → owner preview.
    const shop = await resolveShop(supabase, groupSplit.groupSlug)
    if (!shop || shop.lifecycleState === 'dissolved') {
      notFound()
    }
    const [items, badge, { data: auth }] = await Promise.all([
      resolveShopItems(supabase, shop.groupId),
      resolveLocalOwnerBadge(supabase, {
        groupId: shop.groupId,
        anchorLocationId: shop.anchorLocationId,
      }),
      supabase.auth.getUser(),
    ])
    return (
      <ShopPublicPage
        shop={shop}
        items={items}
        badge={badge}
        loggedIn={Boolean(auth.user)}
      />
    )
  }

  const resolved = await resolvePlacePath(supabase, slug)

  if (!resolved) {
    notFound()
  }

  const { place, ancestors } = resolved

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PlaceBreadcrumb place={place} ancestors={ancestors} />
      <h1 className="mt-4 text-2xl font-semibold" data-testid="place-display-name">
        {place.display_name}
      </h1>
      <p className="mt-2 text-sm text-gray-600" data-testid="place-kind">
        {place.kind}
      </p>

      {/* b2 surface — curated place landing (locations / groups / recent items
          in this scope). Placeholder at b1.x per places.md § T2. */}
      <section className="mt-8 rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
        <p>
          The curated landing for this place ships at b2 (places.md § T2).
          For now, you&apos;ve confirmed the URL resolves and the place tree
          is wired.
        </p>
      </section>
    </main>
  )
}
