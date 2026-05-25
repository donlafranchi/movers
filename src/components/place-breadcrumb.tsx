// T060 — Place breadcrumb component.
//
// Server component (no client JS). ARIA per WCAG 2.1: nav[aria-label="Breadcrumb"]
// + ordered list + aria-current="page" on the innermost node.
//
// Renders the place's ancestor chain followed by the place itself. Each
// link points to its own canonical place URL — the path is reconstructed
// by chaining each ancestor's slug from outermost to that node.

import Link from 'next/link'
import type { PlaceRow } from '@/lib/places/resolve-path'

interface Props {
  place: PlaceRow
  ancestors: PlaceRow[]
}

function pathFor(chain: PlaceRow[], indexInclusive: number): string {
  return '/p/' + chain
    .slice(0, indexInclusive + 1)
    .map((p) => p.slug)
    .join('/')
}

export function PlaceBreadcrumb({ place, ancestors }: Props) {
  const fullChain: PlaceRow[] = [...ancestors, place]

  return (
    <nav aria-label="Breadcrumb" data-testid="place-breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {fullChain.map((node, i) => {
          const isLast = i === fullChain.length - 1
          return (
            <li key={node.id} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-gray-400" aria-hidden="true">
                  /
                </span>
              )}
              {isLast ? (
                <span aria-current="page" className="font-medium">
                  {node.display_name}
                </span>
              ) : (
                <Link href={pathFor(fullChain, i)} className="text-blue-600 hover:underline">
                  {node.display_name}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
