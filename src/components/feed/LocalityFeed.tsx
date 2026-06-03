// T088 — Anonymous, locality-defaulted home feed (F030).
//
// Async server component. Resolves the viewing Place (Member primary_home →
// ?place=<slug> → launch default), pulls the locality feed, and renders the
// signup banner (anon), the scope picker, and the cards — or the
// widen-locality empty state when nothing matches.

import { createClient } from '@/lib/supabase-server'
import { getLocalityFeed, widenLocality } from '@/lib/feed/locality-feed'
import { resolveFeedPlace } from '@/lib/feed/feed-place'
import { ItemFeedCard } from './ItemFeedCard'
import { FeedEmptyState } from './FeedEmptyState'
import { MakeThisYoursBanner } from './MakeThisYoursBanner'
import { ScopePicker, type ScopeOption } from './ScopePicker'

export async function LocalityFeed({ requestedSlug }: { requestedSlug?: string }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // An authenticated Member's primary_home, if set.
  let memberPlaceId: string | null = null
  let memberInterestTags: string[] = []
  if (user) {
    const { data: home } = await supabase
      .from('member_place_interests')
      .select('place_id')
      .eq('member_id', user.id)
      .eq('scope_kind', 'primary_home')
      .is('removed_at', null)
      .maybeSingle()
    memberPlaceId = (home as { place_id: string } | null)?.place_id ?? null

    const { data: interests } = await supabase
      .from('member_interests')
      .select('tag')
      .eq('member_id', user.id)
    memberInterestTags = ((interests ?? []) as { tag: string }[]).map((r) => r.tag)
  }

  const place = await resolveFeedPlace(supabase, { memberPlaceId, requestedSlug })

  // IP-geolocation-fail edge case: no resolvable Place → picker-first.
  if (!place) {
    return (
      <section className="mx-auto max-w-3xl space-y-4 p-4" data-testid="locality-feed">
        <MakeThisYoursBanner isAuthenticated={!!user} />
        <div className="card p-6 text-center" data-testid="feed-no-place">
          <h3 className="text-sm font-semibold text-neutral-900">Where are you?</h3>
          <p className="mt-1 text-xs text-neutral-600">
            We couldn’t detect your locality. Pick a Place to see what’s nearby.
          </p>
        </div>
      </section>
    )
  }

  const items = await getLocalityFeed(supabase, {
    placeId: place.placeId,
    interestTags: memberInterestTags,
  })

  // Scope-picker options: a handful of localities, current included.
  const { data: nbhd } = await supabase
    .from('places')
    .select('slug, display_name')
    .eq('kind', 'neighborhood')
    .is('deleted_at', null)
    .limit(12)
  const options: ScopeOption[] = [
    { slug: place.slug, displayName: place.displayName },
    ...(((nbhd ?? []) as { slug: string; display_name: string }[])
      .filter((o) => o.slug !== place.slug)
      .map((o) => ({ slug: o.slug, displayName: o.display_name }))),
  ]

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-4" data-testid="locality-feed">
      <MakeThisYoursBanner isAuthenticated={!!user} />
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900">Near {place.displayName}</h2>
        <ScopePicker current={place.slug} options={options} />
      </div>

      {items.length === 0 ? (
        <FeedEmptyState parent={await widenLocality(supabase, place.placeId)} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => (
            <ItemFeedCard key={item.itemId} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
