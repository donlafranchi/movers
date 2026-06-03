// T082 — Public gathering Item page (F034).
// Spec:   planning/now/scenario-F034-member-hosts-recurring-gathering.md §
//         Item page shows next occurrence + Share-link.
//
// Server component (presentational). Renders title, description, next
// occurrence (human date, computed by the route), recurrence in human terms,
// location with a map-pin, cost (or "Free"), capacity + what-to-bring when
// present, the host (links to /m/<handle>), and the Share-link affordance.

import Link from 'next/link'
import { MapPin, CalendarClock, Users } from 'lucide-react'
import type { ResolvedGathering } from '@/lib/items/resolve-gathering'
import { describeRecurrence } from '@/lib/items/resolve-gathering'
import { ShareLinkButton } from './ShareLinkButton'
import { QrCardButton } from './QrCardButton'

export interface GatheringPublicPageProps {
  gathering: ResolvedGathering
  /** Group page href when filed under a Group; null when hosted as a Member. */
  groupHref: string | null
  /** Human-readable next-occurrence date, computed by the route (real clock). */
  nextOccurrenceLabel: string | null
  /** Canonical URL the Share-link copies / shares. */
  shareUrl: string
  /** True when the signed-in viewer owns this Item — gates the QR-card affordance (F041). */
  isOwner?: boolean
}

function formatCost(cents: number | null): string {
  if (cents === null) return 'Free'
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function GatheringPublicPage({
  gathering,
  groupHref,
  nextOccurrenceLabel,
  shareUrl,
  isOwner = false,
}: GatheringPublicPageProps) {
  const recurrence = describeRecurrence(gathering.recurrenceRule)

  return (
    <main className="mx-auto max-w-2xl px-4 py-6" data-testid="gathering-page">
      <article>
        <h1
          className="text-2xl font-semibold leading-tight"
          data-testid="gathering-title"
        >
          {gathering.title}
        </h1>

        {/* T095 — attribution (see ProductPublicPage for the model). */}
        {gathering.attribution.kind === 'group' && groupHref ? (
          <p className="mt-2 text-sm font-medium" data-testid="gathering-attribution">
            Hosted by{' '}
            <Link
              href={groupHref}
              data-testid="gathering-attribution-link"
              className="text-[--color-accent] hover:underline"
            >
              {gathering.attribution.name}
            </Link>
          </p>
        ) : gathering.attribution.kind === 'member' ? (
          <p className="mt-2 text-sm font-medium" data-testid="gathering-attribution">
            Hosted by{' '}
            {gathering.attribution.isDiscoverable ? (
              <Link
                href={`/m/${gathering.attribution.handle}`}
                data-testid="gathering-attribution-link"
                className="text-[--color-accent] hover:underline"
              >
                {gathering.attribution.displayName}
              </Link>
            ) : (
              <span data-testid="gathering-attribution-text">
                {gathering.attribution.displayName}
              </span>
            )}
          </p>
        ) : null}

        <section className="mt-4 space-y-1.5 text-sm">
          {nextOccurrenceLabel ? (
            <p
              className="flex items-center gap-1.5 font-medium text-[--color-fg]"
              data-testid="gathering-next-occurrence"
            >
              <CalendarClock size={16} aria-hidden="true" />
              {nextOccurrenceLabel}
            </p>
          ) : null}
          {recurrence ? (
            <p
              className="text-[--color-fg-muted]"
              data-testid="gathering-recurrence"
            >
              {recurrence}
            </p>
          ) : null}
        </section>

        {gathering.description ? (
          <p
            className="mt-4 whitespace-pre-line text-[--color-fg]"
            data-testid="gathering-description"
          >
            {gathering.description}
          </p>
        ) : null}

        {gathering.location ? (
          <section
            className="mt-6 rounded-xl border border-neutral-200 p-4"
            data-testid="gathering-location"
          >
            <h2 className="text-sm font-semibold text-[--color-fg]">Where</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[--color-fg-muted]">
              <MapPin size={16} aria-hidden="true" />
              {gathering.location.label}
            </p>
          </section>
        ) : null}

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="font-semibold text-[--color-fg]">Cost</dt>
            <dd data-testid="gathering-cost" className="text-[--color-fg-muted]">
              {formatCost(gathering.costCents)}
            </dd>
          </div>
          {gathering.capacity !== null ? (
            <div>
              <dt className="font-semibold text-[--color-fg]">Capacity</dt>
              <dd
                data-testid="gathering-capacity"
                className="flex items-center gap-1.5 text-[--color-fg-muted]"
              >
                <Users size={16} aria-hidden="true" />
                {gathering.capacity}
              </dd>
            </div>
          ) : null}
        </dl>

        {gathering.whatToBring ? (
          <section className="mt-4" data-testid="gathering-what-to-bring">
            <h2 className="text-sm font-semibold text-[--color-fg]">What to bring</h2>
            <p className="mt-1 whitespace-pre-line text-sm text-[--color-fg-muted]">
              {gathering.whatToBring}
            </p>
          </section>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <ShareLinkButton url={shareUrl} />
          {isOwner ? <QrCardButton itemId={gathering.itemId} /> : null}
        </div>

        {/* T095 — the standalone "Hosted by [Member]" line is folded into the
            attribution block above. */}
      </article>
    </main>
  )
}
