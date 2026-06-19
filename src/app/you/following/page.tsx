// T109 — /you/following management page (F042, Loop 8).
//
// Authed surface: anon → sign-in with a return URL. Reads the unified follows
// union (T108 getMemberFollows) as the signed-in Member (RLS owner-scoped),
// resolves listed-member counts for the followed Groups from the privacy-
// preserving projection (T095), and hands both to the client manager, which
// renders the People / Groups / Venues sections + Unfollow/Leave/Undo.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getMemberFollows } from '@/lib/follows/get-member-follows'
import { getListedMemberCounts } from '@/lib/follows/get-listed-member-counts'
import { FollowingManager } from '@/components/follows/FollowingManager'

export const metadata = {
  title: 'Following — Movers, Makers & Shakers',
}

export default async function FollowingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?next=/you/following')

  const entries = await getMemberFollows(supabase, user.id)
  const groupIds = entries.filter((e) => e.kind === 'group').map((e) => e.entityId)
  const groupCounts = await getListedMemberCounts(supabase, groupIds)

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24" data-testid="following-page">
      <h1 className="text-2xl font-semibold">Following</h1>
      <p className="mt-0.5 text-sm text-neutral-600">Everything you follow, in one place.</p>
      <div className="mt-6">
        <FollowingManager entries={entries} groupCounts={groupCounts} />
      </div>
    </main>
  )
}
