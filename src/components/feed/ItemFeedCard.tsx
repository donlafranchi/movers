// T088 — Locality feed card (F030). Presentational; kind-aware.
import Link from 'next/link'
import type { FeedItem } from '@/lib/feed/locality-feed'
import { itemHref, kindLabel } from '@/lib/feed/item-url'

export function ItemFeedCard({ item }: { item: FeedItem }) {
  const href = itemHref({
    kind: item.kind,
    ownerHandle: item.ownerHandle,
    title: item.title,
    itemId: item.itemId,
  })
  const owner = item.brandLabel ?? item.ownerDisplayName

  return (
    <Link href={href} className="card card-hover block overflow-hidden" data-testid="feed-item-card">
      <div className="p-3">
        <span className="chip text-[11px]" data-testid="feed-item-kind">
          {kindLabel(item.kind)}
        </span>
        <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold text-neutral-900">{item.title}</h3>
        <p className="mt-1 truncate text-xs text-neutral-600">{owner}</p>
        {item.nearestLocationLabel && (
          <p className="mt-0.5 truncate text-xs text-neutral-500">{item.nearestLocationLabel}</p>
        )}
      </div>
    </Link>
  )
}
