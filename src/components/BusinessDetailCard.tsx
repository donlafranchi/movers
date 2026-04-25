'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { OwnershipBadge } from './OwnershipBadge'
import { SupportButton } from './SupportButton'
import { ReportForm } from './ReportForm'
import { Toast } from './Toast'
import { AuthGateModal } from './AuthGateModal'
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
  const [reportOpen, setReportOpen] = useState(false)
  const [authGateOpen, setAuthGateOpen] = useState(false)

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
      data-extractive={business.ownership_tier === 'pe-corporate' ? 'true' : undefined}
      className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-6px_16px_rgba(0,0,0,0.12)] p-6 pb-8 z-30 max-h-[70vh] overflow-y-auto"
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-4 text-[--color-fg-muted] hover:text-[--color-fg] text-2xl leading-none transition-colors"
        aria-label="Close"
      >
        ×
      </button>

      <h2 data-testid="business-name" className="text-[22px] font-bold pr-8 leading-tight text-[--color-fg]">
        {business.name}
      </h2>

      <OwnershipBadge tier={business.ownership_tier} className="mt-2" />

      <p data-testid="business-address" className="text-sm text-[--color-fg-muted] mt-3">
        {business.street_address}, {business.city}, {business.state} {business.zip}
      </p>

      <p data-testid="business-category" className="text-sm text-[--color-fg-muted] mt-1">
        {business.category}
      </p>

      {business.ownership_tier === 'pe-corporate' && (
        <>
          {business.parent_company && (
            <p data-testid="parent-company" className="text-sm text-[--color-fg-muted] mt-1">
              Parent: {business.parent_company}
            </p>
          )}
          {business.location_count != null && (
            <p data-testid="location-count" className="text-sm text-[--color-fg-muted]">
              {business.location_count.toLocaleString()} locations
            </p>
          )}
        </>
      )}

      {business.ownership_tier === 'mission-driven' && business.certification_type && (
        <p data-testid="certification-type" className="text-sm text-[--color-fg-muted] mt-1">
          {business.certification_type}
        </p>
      )}

      {hasStory && (
        <div data-testid="business-story" className="mt-4 pt-4 border-t border-[--color-border]">
          <p className="text-[15px] leading-relaxed text-[--color-fg]">
            {storyIsLong && !storyExpanded
              ? business.story!.slice(0, STORY_TRUNCATE_LENGTH) + '...'
              : business.story}
          </p>
          {storyIsLong && !storyExpanded && (
            <button
              data-testid="read-more"
              onClick={() => setStoryExpanded(true)}
              className="text-sm text-[--color-fg] underline mt-2"
            >
              Read more
            </button>
          )}
        </div>
      )}

      <div className="mt-5">
        {user ? (
          <SupportButton businessId={business.id} userId={user.id} />
        ) : (
          <button
            type="button"
            onClick={() => setAuthGateOpen(true)}
            data-testid="sign-in-to-support"
            className="btn-primary w-full"
          >
            Support
          </button>
        )}
      </div>
      <AuthGateModal
        open={authGateOpen}
        onClose={() => setAuthGateOpen(false)}
        intent="support"
        headline={`Sign up to support ${business.name}`}
        subtext="Hearted businesses save to your profile and let owners see what you care about."
      />

      <div className="flex gap-2 mt-3">
        {user ? (
          <button
            data-testid="report-concern-button"
            onClick={() => setReportOpen(true)}
            className="btn-secondary flex-1 !py-2.5"
          >
            Report a Concern
          </button>
        ) : (
          <Link
            href="/auth/login"
            data-testid="sign-in-to-report"
            className="btn-secondary flex-1 !py-2.5"
          >
            Sign in to report
          </Link>
        )}
        <button
          data-testid="share-button"
          onClick={handleShare}
          className="btn-secondary !py-2.5 !px-5"
        >
          Share
        </button>
      </div>

      <Toast
        message="Link copied to clipboard"
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />

      {reportOpen && user && (
        <ReportForm
          businessId={business.id}
          userId={user.id}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  )
}
