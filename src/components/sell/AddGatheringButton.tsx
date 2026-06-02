'use client'

// T081 — Client island: "Host a gathering" button that opens <GatheringComposer>.
// Appended to the data-driven COMPOSERS array on /you/sell (T080). Keeps the
// accessible name /Host a gathering/i.

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { GatheringComposer } from './GatheringComposer'
import { createGatheringAction } from '@/app/you/sell/gathering/actions'

export interface AddGatheringButtonProps {
  groupId: string
  groupName: string
  anchorLocationId?: string | null
  anchorLocationLabel?: string | null
}

export function AddGatheringButton({
  groupId,
  groupName,
  anchorLocationId = null,
  anchorLocationLabel = null,
}: AddGatheringButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const createGathering = useCallback(
    (input: {
      title: string
      description: string
      gatheringKind: 'one_time' | 'recurring' | 'open_meetup'
      startsAt?: string
      recurrenceRule?: string
      capacity?: number
      costCents?: number | null
      whatToBring?: string
      locationId?: string
    }) => createGatheringAction({ ...input, groupId }),
    [groupId],
  )

  return (
    <>
      <button
        type="button"
        data-testid={`you-sell-add-gathering-${groupId}`}
        className="btn-secondary text-sm"
        aria-label={`Host a gathering at ${groupName}`}
        onClick={() => setOpen(true)}
      >
        Host a gathering
      </button>

      {open && (
        <GatheringComposer
          createGathering={createGathering}
          defaultLocationId={anchorLocationId}
          defaultLocationLabel={anchorLocationLabel}
          redirect={(url) => router.push(url)}
          showToast={(msg) => setToast(msg)}
          onAbandon={() => setOpen(false)}
        />
      )}

      {toast && (
        <div
          role="status"
          data-testid="add-gathering-toast"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  )
}
