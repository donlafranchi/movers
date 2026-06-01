// T073 — `/you/sell` index stub for Members with an active business Group.
// Spec:   T073 § Acceptance Criteria — third routing branch.
//
// Thin b1 surface. Lists the caller's active kind='business' Group(s) and
// shows an "Add a product" CTA per Group. Product, service, and gathering
// composers are F038 / F040 / F034 — not this ticket. The CTAs route to
// `#` placeholders at b1; they wire up when those composers land.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

export default async function SellIndexPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    redirect('/auth/login?next=/you/sell')
  }
  const memberId = auth.user!.id

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select('group_id, groups!inner(id, slug, name, kind, lifecycle_state)')
    .eq('member_id', memberId)
    .is('left_at', null)
    .eq('groups.kind', 'business')
    .eq('groups.lifecycle_state', 'active')

  type Row = {
    group_id: string
    groups: { id: string; slug: string; name: string; kind: string; lifecycle_state: string }
  }
  const shops = (memberships ?? []) as unknown as Row[]

  // No active Shops AND we got here? Send the user back to /you to pick up
  // the walkthrough — the CTA logic shouldn't have routed them here.
  if (shops.length === 0) {
    redirect('/you')
  }

  return (
    <main
      className="pb-24 max-w-3xl mx-auto p-4"
      data-testid="you-sell-index"
    >
      <header>
        <h1 className="text-2xl font-semibold">Your shops</h1>
        <p className="mt-1 text-sm text-neutral-600">
          List a product, service, or gathering under one of your shops.
        </p>
      </header>

      <ul className="mt-6 space-y-3" data-testid="you-sell-shop-list">
        {shops.map((row) => (
          <li
            key={row.group_id}
            data-testid={`you-sell-shop-${row.group_id}`}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-3 flex items-center justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{row.groups.name}</p>
              <p className="text-xs text-neutral-500">Active shop</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`#`}
                data-testid={`you-sell-add-product-${row.group_id}`}
                className="btn-secondary text-sm"
                aria-label={`Add a product to ${row.groups.name}`}
              >
                Add a product
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-neutral-500">
        Service and gathering composers land in upcoming bundles (F040, F034).
        Multi-owner partnership Groups land in b2.
      </p>
    </main>
  )
}
