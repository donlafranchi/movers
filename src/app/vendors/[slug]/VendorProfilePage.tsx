'use client'

import Link from 'next/link'
import type { Vendor, Market, VendorCategory } from '@/lib/types'
import { CATEGORIES } from '@/lib/categories'
import { formatNextMarketDate } from '@/lib/market-dates'
import { FollowButton } from '@/components/FollowButton'
import { WEEKDAYS } from '@/lib/types'

interface Props {
  vendor: Vendor
  markets: Market[]
  categories: VendorCategory[]
}

function formatDays(days: string[]): string {
  return days
    .map((d) => WEEKDAYS.find((w) => w.slug === d)?.long ?? d)
    .join(', ')
}

export function VendorProfilePage({ vendor, markets, categories }: Props) {
  return (
    <main className="pb-24" data-vendor-slug={vendor.slug}>
      <div className="h-48 md:h-64 w-full bg-gradient-to-br from-[--color-accent-tint] to-amber-100 relative overflow-hidden">
        {vendor.cover_photo_url ? (
          <img src={vendor.cover_photo_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-5xl opacity-60">
            {categories[0] ? CATEGORIES[categories[0].category_slug as keyof typeof CATEGORIES]?.emoji ?? '🌱' : '🌱'}
          </div>
        )}
      </div>

      <div className="px-4 md:px-6 max-w-3xl mx-auto -mt-8 relative">
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-4 md:p-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-neutral-900">{vendor.name}</h1>
          {vendor.tagline && <p className="text-neutral-600 mt-1">{vendor.tagline}</p>}

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {categories.map((c) => {
                const meta = CATEGORIES[c.category_slug as keyof typeof CATEGORIES]
                return (
                  <span
                    key={c.category_slug}
                    className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700"
                  >
                    {meta?.emoji} {meta?.label ?? c.category_slug}
                  </span>
                )
              })}
            </div>
          )}

          <div className="mt-4 hidden md:flex gap-2">
            <FollowButton vendorId={vendor.id} vendorName={vendor.name} />
          </div>
        </div>

        <section className="mt-6" data-testid="market-schedule">
          <h2 className="text-lg font-semibold text-neutral-900">Market Schedule</h2>
          {markets.length === 0 ? (
            <p className="text-sm text-neutral-600 mt-2">Currently not listed at any markets</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {markets.map((m) => {
                const next = formatNextMarketDate(m.schedule_days)
                return (
                  <li key={m.id} className="border border-neutral-200 rounded-lg p-3 bg-white">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <Link href={`/explore?market=${m.slug}`} className="font-medium text-neutral-900 hover:underline">
                          {m.name}
                        </Link>
                        <p className="text-sm text-neutral-600">
                          {formatDays(m.schedule_days)}
                          {m.schedule_start_time && m.schedule_end_time && (
                            <> · {m.schedule_start_time}–{m.schedule_end_time}</>
                          )}
                        </p>
                        <p className="text-xs text-neutral-500 mt-1">{m.city}, {m.state}</p>
                      </div>
                      {next && (
                        <span className="text-xs font-medium text-[--color-accent] whitespace-nowrap">
                          Next: {next}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {vendor.story && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold text-neutral-900">About</h2>
            <p className="text-sm text-neutral-700 mt-2 leading-relaxed">{vendor.story}</p>
          </section>
        )}

        {(vendor.website_url || vendor.instagram_handle || vendor.contact_email) && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold text-neutral-900">Contact</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {vendor.website_url && (
                <li>
                  <a href={vendor.website_url} className="text-[--color-accent] hover:underline" target="_blank" rel="noreferrer">
                    {vendor.website_url.replace(/^https?:\/\//, '')}
                  </a>
                </li>
              )}
              {vendor.instagram_handle && (
                <li>
                  <a
                    href={`https://instagram.com/${vendor.instagram_handle}`}
                    className="text-[--color-accent] hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{vendor.instagram_handle}
                  </a>
                </li>
              )}
              {vendor.contact_email && (
                <li>
                  <a href={`mailto:${vendor.contact_email}`} className="text-[--color-accent] hover:underline">
                    {vendor.contact_email}
                  </a>
                </li>
              )}
            </ul>
          </section>
        )}
      </div>

      {/* Sticky mobile primary CTA */}
      <div
        className="md:hidden fixed inset-x-0 z-30 bg-white border-t border-neutral-200 px-4 py-3 flex justify-center"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}
        data-testid="sticky-mobile-cta"
      >
        <FollowButton vendorId={vendor.id} vendorName={vendor.name} />
      </div>
    </main>
  )
}
