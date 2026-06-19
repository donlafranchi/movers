'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Vendor, Market, VendorCategory } from '@/lib/types'
import { useMarket } from '@/components/MarketContext'
import { MarketSelector } from '@/components/MarketSelector'
import { VendorCard } from '@/components/VendorCard'
import { RecruitmentGrid } from '@/components/RecruitmentGrid'
import { SellCta } from '@/components/sell/SellCta'
import { FollowingSummary } from '@/components/follows/FollowingSummary'

type Tab = 'saved' | 'following' | 'settings'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

interface VendorWithMeta {
  vendor: Vendor
  primaryCategory: string | null
  nextMarket: Market | null
}

function pickPrimary(cats: VendorCategory[], vendorId: string): string | null {
  const v = cats.filter((c) => c.vendor_id === vendorId)
  const primary = v.find((c) => c.is_primary)
  return primary?.category_slug ?? v[0]?.category_slug ?? null
}

function pickNextMarket(vendorId: string, allMarkets: Market[], links: { vendor_id: string; market_id: string }[]): Market | null {
  const ids = links.filter((l) => l.vendor_id === vendorId).map((l) => l.market_id)
  return allMarkets.find((m) => ids.includes(m.id)) ?? null
}

export default function YouPage() {
  return (
    <Suspense fallback={<main className="p-4 pb-24">Loading…</main>}>
      <YouPageInner />
    </Suspense>
  )
}

function YouPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = (searchParams.get('tab') as Tab) || 'saved'
  const tab: Tab = ['saved', 'following', 'settings'].includes(tabParam) ? tabParam : 'saved'

  const { selectedMarket } = useMarket()
  const [marketSelectorOpen, setMarketSelectorOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasVendor, setHasVendor] = useState(false)
  const [emailsEnabled, setEmailsEnabled] = useState(true)
  const [savedVendors, setSavedVendors] = useState<VendorWithMeta[]>([])
  const [followedVendors, setFollowedVendors] = useState<VendorWithMeta[]>([])

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data }) => {
      const user = data.user
      if (!user) {
        setLoaded(true)
        return
      }
      setEmail(user.email ?? null)
      setUserId(user.id)

      const [
        { data: vendorRow },
        { data: prefs },
        { data: supports },
        { data: follows },
        { data: allCats },
        { data: allMarkets },
        { data: allLinks },
      ] = await Promise.all([
        client.from('businesses').select('slug').eq('user_id', user.id).limit(1).maybeSingle(),
        client.from('user_preferences').select('follow_emails_enabled').eq('user_id', user.id).maybeSingle(),
        client.from('supports').select('business_id').eq('user_id', user.id),
        client.from('follows').select('vendor_id').eq('user_id', user.id).is('unfollowed_at', null),
        client.from('vendor_categories').select('*'),
        client.from('markets').select('*'),
        client.from('market_vendors').select('vendor_id, market_id'),
      ])

      setHasVendor(!!vendorRow)
      setEmailsEnabled(prefs?.follow_emails_enabled ?? true)

      const cats = (allCats ?? []) as VendorCategory[]
      const markets = (allMarkets ?? []) as Market[]
      const links = (allLinks ?? []) as { vendor_id: string; market_id: string }[]

      const supportIds = (supports ?? []).map((s) => s.business_id)
      const followIds = (follows ?? []).map((f) => f.vendor_id)
      const allIds = Array.from(new Set([...supportIds, ...followIds]))

      if (allIds.length > 0) {
        const { data: vRows } = await client.from('businesses').select('*').in('id', allIds)
        const vendors = (vRows ?? []) as Vendor[]
        const buildMeta = (ids: string[]): VendorWithMeta[] =>
          vendors
            .filter((v) => ids.includes(v.id))
            .map((v) => ({
              vendor: v,
              primaryCategory: pickPrimary(cats, v.id),
              nextMarket: pickNextMarket(v.id, markets, links),
            }))
        setSavedVendors(buildMeta(supportIds))
        setFollowedVendors(buildMeta(followIds))
      }

      setLoaded(true)
    })
  }, [])

  const setTab = (next: Tab) => {
    router.replace(`/you?tab=${next}`, { scroll: false })
  }

  const toggleEmails = async () => {
    if (!userId) return
    const client = supabase()
    const next = !emailsEnabled
    setEmailsEnabled(next)
    await client
      .from('user_preferences')
      .upsert({ user_id: userId, follow_emails_enabled: next, updated_at: new Date().toISOString() })
  }

  const signOut = async () => {
    const client = supabase()
    await client.auth.signOut()
    window.location.href = '/'
  }

  if (!loaded) return <main className="p-4 pb-24">Loading…</main>

  if (!email) {
    return (
      <main className="p-6 pb-24 max-w-md mx-auto text-center">
        <h1 className="text-xl font-semibold">You</h1>
        <p className="mt-3 text-neutral-600 text-sm">Sign in or create an account to follow vendors and save your market.</p>
        <div className="mt-4 flex flex-col gap-2">
          <Link href="/auth/signup" className="btn-primary">Create account</Link>
          <Link href="/auth/login" className="btn-secondary">Log in</Link>
        </div>
        <div className="mt-8 pt-6 border-t border-neutral-200">
          <p className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">Are you a business owner?</p>
          <Link
            href="/join"
            className="mt-3 inline-flex items-center justify-center rounded-full border border-[--color-accent] text-[--color-accent] px-4 py-2 text-sm font-medium hover:bg-[--color-accent-tint]"
          >
            List your business →
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="pb-24 max-w-3xl mx-auto p-4" data-testid="you-page">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">You</h1>
          <p className="text-sm text-neutral-600 mt-0.5">{email}</p>
        </div>
        {hasVendor && (
          <Link
            href="/you/vendor"
            data-testid="vendor-mode-link"
            className="text-sm font-medium text-[--color-accent] hover:underline whitespace-nowrap"
          >
            Switch to vendor mode →
          </Link>
        )}
      </header>

      {/* T073 — Sell CTA (always-visible, 3-branch routing per F036). */}
      <SellCta memberId={userId} />

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 flex items-center justify-between gap-3" data-testid="your-market-row">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-neutral-500 font-semibold">Your Market</p>
          {selectedMarket ? (
            <p className="text-sm font-medium text-neutral-900 truncate">
              {selectedMarket.name} <span className="text-neutral-500 font-normal">· {selectedMarket.city}</span>
            </p>
          ) : (
            <p className="text-sm text-neutral-500">Not set</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMarketSelectorOpen(true)}
          data-testid="change-market"
          className="text-sm font-medium text-[--color-accent] hover:underline"
        >
          Change
        </button>
      </section>

      {/* T108 — F042 unified "Following" summary (card scroll, new-schema follows:
          Members / Groups / Venues). Self-omits when the Member follows nothing. */}
      {userId && <FollowingSummary memberId={userId} />}

      <nav className="mt-6 flex gap-2" role="tablist" data-testid="you-tabs">
        {(['saved', 'following', 'settings'] as Tab[]).map((t) => {
          const active = tab === t
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`tab-${t}`}
              data-active={active}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                active
                  ? 'bg-[--color-accent] text-white'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {t}
            </button>
          )
        })}
      </nav>

      <div className="mt-6">
        {tab === 'saved' && <SavedTab rows={savedVendors} />}
        {tab === 'following' && <FollowingTab rows={followedVendors} />}
        {tab === 'settings' && (
          <SettingsTab emailsEnabled={emailsEnabled} onToggleEmails={toggleEmails} onSignOut={signOut} />
        )}
      </div>

      {!hasVendor && (
        <div className="mt-12">
          <RecruitmentGrid />
        </div>
      )}

      <MarketSelector open={marketSelectorOpen} onClose={() => setMarketSelectorOpen(false)} userLocation={null} />
    </main>
  )
}

function SavedTab({ rows }: { rows: VendorWithMeta[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="No saved businesses yet. Tap the heart on any listing to save it."
      />
    )
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="saved-list">
      {rows.map((r) => (
        <VendorCard
          key={r.vendor.id}
          vendor={r.vendor}
          primaryCategory={r.primaryCategory}
          nextMarket={r.nextMarket}
        />
      ))}
    </div>
  )
}

function FollowingTab({ rows }: { rows: VendorWithMeta[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="Not following anyone yet. Follow vendors to see their bulletins and updates."
      />
    )
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="following-list">
      {rows.map((r) => (
        <VendorCard
          key={r.vendor.id}
          vendor={r.vendor}
          primaryCategory={r.primaryCategory}
          nextMarket={r.nextMarket}
        />
      ))}
    </div>
  )
}

function SettingsTab({
  emailsEnabled,
  onToggleEmails,
  onSignOut,
}: {
  emailsEnabled: boolean
  onToggleEmails: () => void
  onSignOut: () => void
}) {
  return (
    <div className="space-y-4" data-testid="settings-panel">
      <div>
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">Notifications</h2>
        <label className="flex items-center justify-between bg-white border border-neutral-200 rounded-lg px-4 py-3 text-sm">
          <span>Email me when followed vendors are at upcoming markets</span>
          <input type="checkbox" checked={emailsEnabled} onChange={onToggleEmails} className="h-4 w-4" />
        </label>
      </div>
      <button onClick={onSignOut} className="text-sm text-neutral-600 underline">
        Sign out
      </button>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-10 px-6 border border-dashed border-neutral-300 rounded-xl">
      <p className="text-sm text-neutral-600">{message}</p>
      <Link
        href="/explore"
        className="mt-4 inline-flex items-center justify-center rounded-full bg-[--color-accent] text-white px-4 py-2 text-sm font-medium"
      >
        Explore →
      </Link>
    </div>
  )
}
