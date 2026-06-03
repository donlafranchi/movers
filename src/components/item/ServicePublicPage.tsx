// T083 — Public service Item page (F040).
// Spec:   planning/now/scenario-F040-producer-lists-service.md § Item page shows
//         brand + service area + pricing; § No Locally Made step on services.
//
// Server component (presentational). Renders title, description, rate (by
// model), the service-area section, brand resolve-up (links to the Group page),
// and the owner Member (links to /m/<handle>). There is NO Locally Made badge —
// services are excluded from the provenance flow.
//
// The service-area circle renders as a static statement at b1 (the geography's
// load-bearing job is feed-area intersection, verified by the F040 eval); the
// Mapbox circle is deferred, mirroring the product page's static pickup marker.

import Link from 'next/link'
import { MapPin } from 'lucide-react'
import type { ResolvedService } from '@/lib/items/resolve-service'
import { QrCardButton } from './QrCardButton'

export interface ServicePublicPageProps {
  service: ResolvedService
  /** Group page href when filed under a business Group; null when individual. */
  groupHref: string | null
  /** True when the signed-in viewer owns this Item — gates the QR-card affordance (F041). */
  isOwner?: boolean
}

function formatRate(model: ResolvedService['rateModel'], cents: number | null): string {
  if (model === 'quote') return 'Request a quote'
  if (cents === null) return 'Free'
  const dollars = (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  if (model === 'hourly') return `${dollars} / hr`
  if (model === 'membership') return `${dollars} / mo`
  return dollars
}

export function ServicePublicPage({ service, groupHref, isOwner = false }: ServicePublicPageProps) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6" data-testid="service-page">
      <article>
        <h1
          className="text-2xl font-semibold leading-tight"
          data-testid="service-title"
        >
          {service.title}
        </h1>

        <p className="mt-2 text-xl font-medium" data-testid="service-rate">
          {formatRate(service.rateModel, service.rateCents)}
        </p>

        {/* T095 — attribution (see ProductPublicPage for the model). */}
        {service.attribution.kind === 'group' && groupHref ? (
          <p className="mt-3 text-sm font-medium" data-testid="service-attribution">
            Offered by{' '}
            <Link
              href={groupHref}
              data-testid="service-attribution-link"
              className="text-[--color-accent] hover:underline"
            >
              {service.attribution.name}
            </Link>
          </p>
        ) : service.attribution.kind === 'member' ? (
          <p className="mt-3 text-sm font-medium" data-testid="service-attribution">
            Offered by{' '}
            {service.attribution.isDiscoverable ? (
              <Link
                href={`/m/${service.attribution.handle}`}
                data-testid="service-attribution-link"
                className="text-[--color-accent] hover:underline"
              >
                {service.attribution.displayName}
              </Link>
            ) : (
              <span data-testid="service-attribution-text">
                {service.attribution.displayName}
              </span>
            )}
          </p>
        ) : null}

        {service.description ? (
          <p
            className="mt-4 whitespace-pre-line text-[--color-fg]"
            data-testid="service-description"
          >
            {service.description}
          </p>
        ) : null}

        {service.hasServiceArea ? (
          <section
            className="mt-6 rounded-xl border border-neutral-200 p-4"
            data-testid="service-area"
          >
            <h2 className="text-sm font-semibold text-[--color-fg]">Service area</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[--color-fg-muted]">
              <MapPin size={16} aria-hidden="true" />
              {service.anchor
                ? `Available around ${service.anchor.label} and the surrounding area.`
                : 'Available across a local area.'}
            </p>
          </section>
        ) : null}

        {/* T095 — the standalone "Offered by [Member]" line is folded into the
            attribution block above. */}

        {isOwner ? (
          <div className="mt-6">
            <QrCardButton itemId={service.itemId} />
          </div>
        ) : null}
      </article>
    </main>
  )
}
