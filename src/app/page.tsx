// F030 — Home is the anonymous, locality-defaulted awareness feed.
import { LocalityFeed } from '@/components/feed/LocalityFeed'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ place?: string }>
}) {
  const { place } = await searchParams
  return <LocalityFeed requestedSlug={place} />
}
