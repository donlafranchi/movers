// T088 — Item URL + label maps for the locality feed (F030).
//
// The feed links every Item via its Member-scoped canonical path
// (/m/<handle>/<seg>/<slug>-<id8>). That route exists for every kind
// (T079/T082/T083 + the resolvers), so the feed need not resolve each Item's
// Group place-path. Group-scoped canonical URLs are a later refinement.

import { toSlug } from '@/lib/slugify'

/** items.kind → URL resource segment (CLAUDE.md § Naming conventions). */
export const KIND_SEGMENTS: Record<string, string> = {
  product: 'p',
  service: 's',
  gathering: 'e',
  wonder: 'i',
  offer: 'o',
  ask: 'a',
  initiative: 'initiative',
}

/** items.kind → user-facing UI label (no umbrella "Item" word). */
export const KIND_LABELS: Record<string, string> = {
  product: 'Product',
  service: 'Service',
  gathering: 'Event',
  wonder: 'Idea',
  offer: 'Offer',
  ask: 'Ask',
  initiative: 'Initiative',
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? 'Item'
}

export function itemHref(args: {
  kind: string
  ownerHandle: string
  title: string
  itemId: string
}): string {
  const seg = KIND_SEGMENTS[args.kind] ?? 'p'
  const base = toSlug(args.title) || args.kind
  const slug = `${base}-${args.itemId.slice(0, 8)}`
  return `/m/${args.ownerHandle}/${seg}/${slug}`
}
