// T088 — Locality feed empty state (F030). Friendly message + widen-locality CTA.
import Link from 'next/link'

export function FeedEmptyState({
  parent,
}: {
  // The parent Place to widen to, or null at the state root.
  parent: { displayName: string; slug: string } | null
}) {
  return (
    <div className="card p-6 text-center" data-testid="feed-empty-state">
      <h3 className="text-sm font-semibold text-neutral-900">No matches near you yet.</h3>
      <p className="mt-1 text-xs text-neutral-600">
        {parent
          ? `Browse nearby Places to see what's around.`
          : `Try widening to any Place in your state.`}
      </p>
      {parent ? (
        <Link
          href={`/?place=${parent.slug}`}
          className="btn-secondary mt-3 inline-block"
          data-testid="widen-locality"
        >
          Widen to {parent.displayName}
        </Link>
      ) : (
        <Link href="/?widen=state" className="btn-secondary mt-3 inline-block" data-testid="widen-locality">
          Any Place in your state
        </Link>
      )}
    </div>
  )
}
