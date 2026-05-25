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

interface Props {
  params: Promise<{ slug: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
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
