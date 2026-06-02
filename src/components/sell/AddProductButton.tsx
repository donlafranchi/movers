'use client'

// T078 — Client island: "Add a product" button that opens <ProductComposer>.
// Replaces the inert T073 stub button on /you/sell. Keeps the eval-relied-on
// role=button + accessible name /Add a product/i (see T073b note).

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ProductComposer, type PickupLocationOption } from './ProductComposer'
import { createProductAction } from '@/app/you/sell/product/actions'
import { sellCreateLocationAction } from '@/app/you/sell/actions'

export interface AddProductButtonProps {
  groupId: string
  groupName: string
  anchorLocationId?: string | null
  anchorLocationLabel?: string | null
}

export function AddProductButton({
  groupId,
  groupName,
  anchorLocationId = null,
  anchorLocationLabel = null,
}: AddProductButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const createProduct = useCallback(
    (input: {
      title: string
      description: string
      priceCents: number | null
      priceUnit?: string
      locationId?: string
      madeAtPlaceId?: string
    }) => createProductAction({ ...input, groupId }),
    [groupId],
  )

  const availableLocations: PickupLocationOption[] = anchorLocationId
    ? [{ id: anchorLocationId, label: anchorLocationLabel ?? `${groupName} (anchor)` }]
    : []

  return (
    <>
      <button
        type="button"
        data-testid={`you-sell-add-product-${groupId}`}
        className="btn-secondary text-sm"
        aria-label={`Add a product to ${groupName}`}
        onClick={() => setOpen(true)}
      >
        Add a product
      </button>

      {open && (
        <ProductComposer
          createProduct={createProduct}
          createLocation={(input) => sellCreateLocationAction(input)}
          availableLocations={availableLocations}
          defaultPickupLocationId={anchorLocationId}
          defaultPickupLocationLabel={anchorLocationLabel}
          redirect={(url) => router.push(url)}
          showToast={(msg) => setToast(msg)}
          onAbandon={() => setOpen(false)}
        />
      )}

      {toast && (
        <div
          role="status"
          data-testid="add-product-toast"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  )
}
