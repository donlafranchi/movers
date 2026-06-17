// T104 — Public Venue page shell (F033 read surface).
// Spec: planning/next/scenario-F033-viewer-finds-venue-page.md;
//       product/ui/design-language.md § Venue page.
//
// Presentational + server-renderable. Data fetching lives in the route
// (src/app/p/[...slug]/page.tsx); this component renders the resolved shape so
// it stays unit-testable. The only client island is <FollowVenueButton>.
//
// Shell scope (T104): hero, name, address + distance, CTAs, About. The
// "What's happening here" / "What's happening nearby" content sections ship in
// T105.

import type { ResolvedVenue, LocationKind } from '@/lib/locations/resolve-venue'
import type { FeedItem } from '@/lib/feed/locality-feed'
import { ItemFeedCard } from '@/components/feed/ItemFeedCard'
import { FollowVenueButton } from './FollowVenueButton'

interface Props {
  venue: ResolvedVenue
  loggedIn: boolean
  /** Server-rendered so <FollowVenueButton> mounts in the right state. */
  existingSavedSearchId: string | null
  /** Distance from the viewer's primary-home Place centroid (metres); null = omit. */
  distanceMeters: number | null
  /** Auth-aware target for "Host something here" (composer, or sign-in for anon). */
  hostHref: string
  /** The venue's owning business Group, or null → minimal-page variant. */
  owningGroupId: string | null
  /** "What's happening here" — Items the owning Group hosts at this venue. */
  hostedItems: FeedItem[]
  /** "What's happening nearby" — public Items nearby, excluding the owning Group. */
  nearbyItems: FeedItem[]
}

const KIND_LABELS: Record<LocationKind, string> = {
  permanent: 'Permanent venue',
  recurring_temporary: 'Recurring venue',
  area: 'Area',
}

function milesLabel(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi away`
}

function ItemGrid({ items }: { items: FeedItem[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
      {items.map((item) => (
        <ItemFeedCard key={item.itemId} item={item} />
      ))}
    </div>
  )
}

export function VenuePublicPage({
  venue,
  loggedIn,
  existingSavedSearchId,
  distanceMeters,
  hostHref,
  owningGroupId,
  hostedItems,
  nearbyItems,
}: Props) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {/* Hero — collapses entirely when there is no image (no empty container,
          no ARIA role on an absent element). */}
      {venue.heroImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={venue.heroImageUrl}
          alt={`Photo of ${venue.label}`}
          className="aspect-[4/3] w-full rounded-[--radius-md] object-cover sm:aspect-video"
        />
      )}

      <header className={venue.heroImageUrl ? 'mt-4' : ''}>
        <h1 data-testid="venue-name" className="text-[26px] font-bold leading-tight">
          {venue.label}
        </h1>

        {(venue.streetAddress || distanceMeters != null) && (
          <p className="mt-1 text-sm font-normal text-gray-500">
            {venue.streetAddress && <span>{venue.streetAddress}</span>}
            {distanceMeters != null && (
              <span data-testid="venue-distance">
                {venue.streetAddress ? ' · ' : ''}
                {milesLabel(distanceMeters)}
              </span>
            )}
          </p>
        )}

        <hr className="mt-3 border-t border-[--color-border]" />
      </header>

      {/* CTAs — Follow primary, Host secondary (DLS § Venue page). */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <FollowVenueButton
          loggedIn={loggedIn}
          locationId={venue.locationId}
          venueName={venue.label}
          existingSavedSearchId={existingSavedSearchId}
        />
        <a data-testid="venue-host-cta" href={hostHref} className="btn-secondary">
          Host something here
        </a>
      </div>

      {/* "What's happening here" — venue-hosted Items. Omitted entirely on the
          minimal-page variant (no owning business Group to scope against). */}
      {owningGroupId !== null && (
        <section className="mt-8">
          <h2 className="text-[22px] font-semibold">What&apos;s happening here</h2>
          {hostedItems.length === 0 ? (
            <p
              data-testid="venue-here-empty"
              aria-live="polite"
              className="mt-3 rounded border border-dashed border-[--color-border] p-6 text-sm text-gray-500"
            >
              Nothing scheduled yet.
            </p>
          ) : (
            <ItemGrid items={hostedItems} />
          )}
        </section>
      )}

      {/* "What's happening nearby" — collapsed-by-default secondary section.
          Rendered only when there is something to show (no empty expandable). */}
      {nearbyItems.length > 0 && (
        <details data-testid="venue-nearby" className="mt-8">
          <summary className="cursor-pointer text-[22px] font-semibold">
            What&apos;s happening nearby
          </summary>
          <ItemGrid items={nearbyItems} />
        </details>
      )}

      <section data-testid="venue-about" className="mt-8">
        <h2 className="text-lg font-medium">About</h2>
        <span data-testid="venue-kind-tag" className="chip mt-2 inline-block text-xs">
          {KIND_LABELS[venue.kind]}
        </span>
        {venue.description && (
          <p className="mt-3 text-sm text-gray-600">{venue.description}</p>
        )}
        {venue.accessibilityNotes && (
          <p className="mt-3 text-sm text-gray-600">
            <span className="font-medium">Accessibility: </span>
            {venue.accessibilityNotes}
          </p>
        )}
      </section>
    </main>
  )
}
