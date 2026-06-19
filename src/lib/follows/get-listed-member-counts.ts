// T109 — Listed-member-count reader for Group rows (F042).
//
// Counts LISTED memberships per Group from member_public_group_memberships
// (T095 projection: active explicit memberships in non-dissolved, listed
// Groups). This is the same source the public Group page counts from — unlisted
// and private memberships never contribute, so the count surfaced on
// /you/following can never exceed the public count. Never count raw
// group_memberships.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function getListedMemberCounts(
  supabase: SupabaseClient,
  groupIds: string[],
): Promise<Record<string, number>> {
  if (groupIds.length === 0) return {}

  const { data } = await supabase
    .from('member_public_group_memberships')
    .select('group_id')
    .in('group_id', groupIds)

  const counts: Record<string, number> = {}
  for (const row of (data as { group_id: string }[] | null) ?? []) {
    counts[row.group_id] = (counts[row.group_id] ?? 0) + 1
  }
  return counts
}
