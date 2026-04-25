'use client'

import Link from 'next/link'
import type { Vendor, Market } from '@/lib/types'
import { CATEGORIES } from '@/lib/categories'
import { formatNextMarketDate } from '@/lib/market-dates'
import { FollowButton } from './FollowButton'

interface Props {
  vendor: Vendor
  primaryCategory?: string | null
  nextMarket?: Market | null
  compact?: boolean
}

export function VendorCard({ vendor, primaryCategory, nextMarket, compact }: Props) {
  const meta = primaryCategory ? CATEGORIES[primaryCategory as keyof typeof CATEGORIES] : null
  const nextDate = nextMarket ? formatNextMarketDate(nextMarket.schedule_days) : null

  return (
    <div
      data-testid="vendor-card"
      data-vendor-slug={vendor.slug}
      className={`flex-shrink-0 ${compact ? 'w-44' : 'w-56'} card card-hover hover:no-underline`}
    >
      <Link href={`/vendors/${vendor.slug}`} className="block hover:no-underline">
        <div className={`${compact ? 'h-28' : 'h-32'} rounded-xl overflow-hidden bg-[--color-surface] flex items-center justify-center text-3xl`}>
          {vendor.cover_photo_url ? (
            <img src={vendor.cover_photo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{meta?.emoji ?? '🌱'}</span>
          )}
        </div>
        <div className="pt-3 pb-1">
          <p className="font-medium text-[15px] text-[--color-fg] line-clamp-1">{vendor.name}</p>
          {vendor.tagline && (
            <p className="text-sm text-[--color-fg-muted] mt-1 line-clamp-2">{vendor.tagline}</p>
          )}
          {nextMarket && nextDate && (
            <p className="text-sm text-[--color-fg] mt-2 font-medium">
              {nextMarket.name.split(' ')[0]} · {nextDate}
            </p>
          )}
        </div>
      </Link>
      <div className="pt-2">
        <FollowButton vendorId={vendor.id} vendorName={vendor.name} size="sm" />
      </div>
    </div>
  )
}
