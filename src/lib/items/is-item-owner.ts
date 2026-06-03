// T094 — Item ownership check (F041).
// Spec:   planning/now/scenario-F041-producer-generates-qr-card.md § Non-owner
//         cannot request.
//
// Gates the owner-only "Get a QR card" affordance on the public Item pages.
// members.id === the auth user id (per T078), so the session user's id is
// compared directly against items.member_id. Anonymous viewers are never owners.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function isItemOwner(
  supabase: SupabaseClient,
  itemId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false
  const { data } = await supabase
    .from('items')
    .select('id')
    .eq('id', itemId)
    .eq('member_id', userId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data !== null && data !== undefined
}
