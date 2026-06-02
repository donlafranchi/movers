'use client'

// T082 — Client island: "Add a service" button that opens <ServiceComposer>.
// Appended to the data-driven COMPOSERS row on /you/sell (T080 set up the seam).
// Mirrors AddProductButton: role=button + accessible name /Add a service/i.

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ServiceComposer, type PickupLocationOption, type RateModel } from './ServiceComposer'
import { createServiceAction } from '@/app/you/sell/service/actions'
import { sellCreateLocationAction } from '@/app/you/sell/actions'

export interface AddServiceButtonProps {
  groupId: string
  groupName: string
  anchorLocationId?: string | null
  anchorLocationLabel?: string | null
}

export function AddServiceButton({
  groupId,
  groupName,
  anchorLocationId = null,
  anchorLocationLabel = null,
}: AddServiceButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const createService = useCallback(
    (input: {
      title: string
      description: string
      rateModel: RateModel
      rateCents: number | null
      centerLocationId?: string
      radiusMeters?: number
    }) => createServiceAction({ ...input, groupId }),
    [groupId],
  )

  const availableLocations: PickupLocationOption[] = anchorLocationId
    ? [{ id: anchorLocationId, label: anchorLocationLabel ?? `${groupName} (anchor)` }]
    : []

  return (
    <>
      <button
        type="button"
        data-testid={`you-sell-add-service-${groupId}`}
        className="btn-secondary text-sm"
        aria-label={`Add a service to ${groupName}`}
        onClick={() => setOpen(true)}
      >
        Add a service
      </button>

      {open && (
        <ServiceComposer
          createService={createService}
          createLocation={(input) => sellCreateLocationAction(input)}
          availableLocations={availableLocations}
          defaultCenterLocationId={anchorLocationId}
          defaultCenterLocationLabel={anchorLocationLabel}
          redirect={(url) => router.push(url)}
          showToast={(msg) => setToast(msg)}
          onAbandon={() => setOpen(false)}
        />
      )}

      {toast && (
        <div
          role="status"
          data-testid="add-service-toast"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  )
}
