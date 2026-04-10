'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { OwnershipBadge } from './OwnershipBadge'
import { SupportButton } from './SupportButton'
import { Toast } from './Toast'
import { useAuth } from '@/hooks/useAuth'
import type { Business } from '@/lib/types'

const STORY_TRUNCATE_LENGTH = 200

interface BusinessDetailCardProps {
  business: Business
  onClose: () => void
}

export function BusinessDetailCard({ business, onClose }: BusinessDetailCardProps) {
  const { user } = useAuth()
  const [storyExpanded, setStoryExpanded] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/business/${business.slug}`
    navigator.clipboard?.writeText(url)
    setToastVisible(true)
  }, [business.slug])

  const hasStory = business.story && business.story.trim().length > 0
  const storyIsLong = hasStory && business.story!.length > STORY_TRUNCATE_LENGTH

  return (
    <div
      data-testid="business-detail-card"
      className="absolute bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 rounded-t-2xl shadow-lg p-4 pb-6 z-30 max-h-[70vh] overflow-y-auto"
    >
      <button
        onClick={onClose}
        className="absolute top-2 right-3 text-zinc-400 text-xl"
        aria-label="Close"
      >
        ×
      </button>

      <h2 data-testid="business-name" className="text-lg font-bold pr-8">
        {business.name}
      </h2>

      <OwnershipBadge tier={business.ownership_tier} className="mt-1" />

      <p data-testid="business-address" className="text-sm text-zinc-500 mt-2">
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
        <div data-testid="business-story" className="mt-3">
          <p className="text-sm">
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
        {user ? (
          <SupportButton businessId={business.id} userId={user.id} />
        ) : (
          <Link
            href="/auth/login"
            data-testid="sign-in-to-support"
            className="inline-block text-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 py-2 px-4 text-sm"
          >
            Sign in to support
          </Link>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        {user ? (
          <button
            data-testid="report-concern-button"
            className="flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 py-2 text-sm font-medium"
          >
            Report a Concern
          </button>
        ) : (
          <Link
            href="/auth/login"
            data-testid="sign-in-to-report"
            className="flex-1 text-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 py-2 text-sm"
          >
            Sign in to report
          </Link>
        )}
        <button
          data-testid="share-button"
          onClick={handleShare}
          className="rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-4 py-2 text-sm font-medium"
        >
          Share
        </button>
      </div>

      <Toast
        message="Link copied to clipboard"
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />
    </div>
  )
}
