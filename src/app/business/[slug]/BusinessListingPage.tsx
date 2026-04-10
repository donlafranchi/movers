'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { OwnershipBadge } from '@/components/OwnershipBadge'
import { Toast } from '@/components/Toast'
import { useAuth } from '@/hooks/useAuth'
import type { Business } from '@/lib/types'

const MapPreview = dynamic(
  () => import('@/components/MapPreview').then((m) => m.MapPreview),
  { ssr: false }
)

const STORY_TRUNCATE_LENGTH = 300

interface BusinessListingPageProps {
  business: Business
  supportCount: number
}

export function BusinessListingPage({ business, supportCount }: BusinessListingPageProps) {
  const { user } = useAuth()
  const [storyExpanded, setStoryExpanded] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)

  const hasStory = business.story && business.story.trim().length > 0
  const storyIsLong = hasStory && business.story!.length > STORY_TRUNCATE_LENGTH

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/business/${business.slug}`
    navigator.clipboard?.writeText(url)
    setToastVisible(true)
  }, [business.slug])

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-lg">
        <h1 data-testid="business-name" className="text-2xl font-bold">
          {business.name}
        </h1>

        <OwnershipBadge tier={business.ownership_tier} className="mt-2" />

        <p data-testid="business-address" className="text-sm text-zinc-500 mt-3">
          {business.street_address}, {business.city}, {business.state} {business.zip}
        </p>

        <p data-testid="business-category" className="text-sm text-zinc-500 mt-1">
          {business.category}
        </p>

        {business.ownership_tier === 'pe-corporate' && (
          <>
            {business.parent_company && (
              <p data-testid="parent-company" className="text-sm text-zinc-500 mt-1">
                Parent: {business.parent_company}
              </p>
            )}
            {business.location_count != null && (
              <p data-testid="location-count" className="text-sm text-zinc-500">
                {business.location_count.toLocaleString()} locations
              </p>
            )}
          </>
        )}

        {business.ownership_tier === 'mission-driven' && business.certification_type && (
          <p data-testid="certification-type" className="text-sm text-zinc-500 mt-1">
            {business.certification_type}
          </p>
        )}

        {hasStory && (
          <div data-testid="business-story" className="mt-4">
            <p className="text-sm leading-relaxed">
              {storyIsLong && !storyExpanded
                ? business.story!.slice(0, STORY_TRUNCATE_LENGTH) + '...'
                : business.story}
            </p>
            {storyIsLong && !storyExpanded && (
              <button
                data-testid="read-more"
                onClick={() => setStoryExpanded(true)}
                className="text-sm text-blue-600 mt-1"
              >
                Read more
              </button>
            )}
          </div>
        )}

        <div className="mt-4">
          <span data-testid="support-count" className="text-sm text-zinc-500">
            {supportCount} {supportCount === 1 ? 'supporter' : 'supporters'}
          </span>
        </div>

        {business.latitude != null && business.longitude != null && (
          <div className="mt-4">
            <MapPreview
              latitude={business.latitude}
              longitude={business.longitude}
              ownershipTier={business.ownership_tier}
            />
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {user ? (
            <>
              <button
                data-testid="support-button"
                className="flex-1 rounded-full bg-red-50 text-red-600 py-2 text-sm font-medium"
              >
                ❤️ Support
              </button>
              <button
                data-testid="report-concern-button"
                className="flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 py-2 text-sm font-medium"
              >
                Report a Concern
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                data-testid="sign-in-to-support"
                className="flex-1 text-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 py-2 text-sm"
              >
                Sign in to support
              </Link>
              <Link
                href="/auth/login"
                data-testid="sign-in-to-report"
                className="flex-1 text-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 py-2 text-sm"
              >
                Sign in to report
              </Link>
            </>
          )}
          <button
            data-testid="share-button"
            onClick={handleShare}
            className="rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-4 py-2 text-sm font-medium"
          >
            Share
          </button>
        </div>

        <div className="mt-6">
          <Link href="/" className="text-sm text-blue-600">
            ← Back to map
          </Link>
        </div>
      </div>

      <Toast
        message="Link copied to clipboard"
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />
    </div>
  )
}
