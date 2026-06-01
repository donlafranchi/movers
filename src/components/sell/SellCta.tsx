'use client'

// T073 — `/you` Sell CTA + routing.
// Spec:   planning/now/scenario-F036-member-creates-business-group-via-sell-walkthrough.md § "Sell" CTA visible on /you for any Member
// Ticket: development/tickets/T073-sell-walkthrough-and-you-sell-cta.md
//
// Three CTA branches, all anchored to a single visible button labeled "Sell":
//
//   1. No active business Group AND no in-flight draft → opens the walkthrough at step 1.
//   2. In-flight draft Group                            → opens the walkthrough with resume hint;
//                                                          button label reads "Continue setting up your shop".
//   3. ≥1 active business-Group membership              → routes to /you/sell (the active-seller index).
//
// The CTA stays present in all three branches per F036's
// "Sell CTA visible on /you for any Member" acceptance criterion.

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import {
  getDraftGroup,
  type SellRoutingSignal,
  type DraftGroupSummary,
} from '@/lib/sell/getDraftGroup'
import {
  SellWalkthrough,
  type AnchorLocationOption,
} from './SellWalkthrough'
import {
  sellCreateDraftAction,
  sellUpdateDraftAction,
  sellActivateAction,
  sellCreateLocationAction,
} from '@/app/you/sell/actions'

interface SellCtaProps {
  /** Member id (= auth.users.id). When absent, CTA is hidden (signed-out shell). */
  memberId: string | null
  /** Caller passes a stable supabase browser-client factory so the test seam
   *  can inject a stub. In production, leave undefined and the default factory
   *  reads from NEXT_PUBLIC_SUPABASE_*. */
  supabaseFactory?: () => ReturnType<typeof createBrowserClient>
  /** Caller may inject available Locations (otherwise fetched on mount). */
  initialLocations?: AnchorLocationOption[]
}

function defaultSupabaseFactory() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}

export function SellCta({
  memberId,
  supabaseFactory,
  initialLocations,
}: SellCtaProps) {
  const router = useRouter()
  const [signal, setSignal] = useState<SellRoutingSignal | null>(null)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // M2 fix-now: auto-clear the toast after 4s so it doesn't pin to the screen
  // on a stale navigation. Polite-region screen-reader announcement still
  // fires; visual persistence is what we don't want.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(id)
  }, [toast])
  const [locations, setLocations] = useState<AnchorLocationOption[]>(
    initialLocations ?? [],
  )

  // Load routing signal + Locations on mount.
  useEffect(() => {
    if (!memberId) return
    let cancelled = false
    const sb = (supabaseFactory ?? defaultSupabaseFactory)()
    ;(async () => {
      try {
        const res = await getDraftGroup(sb, memberId)
        if (!cancelled) setSignal(res)
      } catch {
        // Swallow: render the first-time-Seller branch as a safe default
        // when the lookup fails. The CTA stays visible.
        if (!cancelled) setSignal({ draftGroup: null, hasActiveBusinessGroup: false })
      }
      // Load saved Locations the user owns (for the anchor picker).
      if (!initialLocations) {
        const { data } = await sb
          .from('locations')
          .select('id, display_name')
          .limit(20)
        if (!cancelled && data) {
          setLocations(
            data.map((r: { id: string; display_name: string | null }) => ({
              id: r.id,
              label: r.display_name ?? 'Untitled Location',
            })),
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [memberId, supabaseFactory, initialLocations])

  const ctaLabel = labelFor(signal)

  const handleCtaClick = useCallback(() => {
    if (!signal) return
    if (signal.hasActiveBusinessGroup) {
      router.push('/you/sell')
      return
    }
    setWalkthroughOpen(true)
  }, [signal, router])

  if (!memberId) return null

  // Hide the button until the routing signal resolves — prevents a label
  // flicker from "Sell" to "Continue setting up your shop" on draft resume.
  // The CTA spec ("always visible") refers to logical presence, not pre-
  // hydration paint; the spinner row stays visible during this brief window.
  const ctaButton = signal ? (
    <button
      type="button"
      onClick={handleCtaClick}
      data-testid="you-sell-cta"
      data-cta-state={
        signal.hasActiveBusinessGroup
          ? 'active'
          : signal.draftGroup
            ? 'resume'
            : 'fresh'
      }
      className="btn-primary"
    >
      {ctaLabel}
    </button>
  ) : (
    <button
      type="button"
      disabled
      data-testid="you-sell-cta-loading"
      className="btn-primary opacity-60"
      aria-busy="true"
    >
      Sell
    </button>
  )

  return (
    <>
      <div
        data-testid="you-sell-cta-row"
        className="mt-4 flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3"
      >
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-neutral-500 font-semibold">
            Your shop
          </p>
          <p className="text-sm text-neutral-700">
            {signal?.hasActiveBusinessGroup
              ? 'List a product or service.'
              : signal?.draftGroup
                ? 'Pick up where you left off.'
                : 'Open a shop on Movers, Makers & Shakers.'}
          </p>
        </div>
        {ctaButton}
      </div>

      {walkthroughOpen && signal && (
        <SellWalkthrough
          createDraft={sellCreateDraftAction}
          updateDraft={sellUpdateDraftAction}
          activate={sellActivateAction}
          createLocation={sellCreateLocationAction}
          availableLocations={locations}
          redirect={(url) => router.push(url)}
          showToast={(msg) => setToast(msg)}
          onAbandon={() => setWalkthroughOpen(false)}
          resume={signal.draftGroup ? resumeFrom(signal.draftGroup) : undefined}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="sell-toast"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-neutral-900 text-white text-sm rounded-full px-4 py-2 shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  )
}

export function labelFor(signal: SellRoutingSignal | null): string {
  if (!signal) return 'Sell'
  if (signal.hasActiveBusinessGroup) return 'Sell'
  if (signal.draftGroup) return 'Continue setting up your shop'
  return 'Sell'
}

function resumeFrom(d: DraftGroupSummary) {
  return {
    groupId: d.groupId,
    brand: d.brandName ?? '',
    anchorLocationId: d.anchorLocationId,
    anchorLocationLabel: null,
    about: d.publicDescription ?? '',
    resumeFromStep: d.resumeFromStep,
  }
}
