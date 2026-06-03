// T095 — Shared fixture helper: flip a seeded Member's discoverability to true.
//
// After T095, member_privacy.is_discoverable defaults to false (a Member is not
// findable as a person until they opt in). Evals whose assertions depend on
// linked attribution (Shop "Founded by", Item "Sold by [Member]") must opt the
// seeded Member in. Plain-text fallback paths are exercised in unit tests.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function markMemberDiscoverable(
  admin: SupabaseClient,
  memberId: string,
): Promise<void> {
  const { error } = await admin
    .from('member_privacy')
    .update({ is_discoverable: true })
    .eq('member_id', memberId)
  if (error) {
    throw new Error(`markMemberDiscoverable(${memberId}): ${error.message}`)
  }
}
