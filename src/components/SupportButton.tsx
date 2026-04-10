'use client'

import { useSupport } from '@/hooks/useSupport'

interface SupportButtonProps {
  businessId: string
  userId: string | null
}

export function SupportButton({ businessId, userId }: SupportButtonProps) {
  const { supported, count, toggle } = useSupport(businessId, userId)

  return (
    <div className="flex items-center gap-3">
      <button
        data-testid="support-button"
        data-active={supported ? 'true' : 'false'}
        onClick={toggle}
        className={`rounded-full py-2 px-4 text-sm font-medium transition ${
          supported
            ? 'bg-red-100 text-red-600'
            : 'bg-red-50 text-red-600'
        }`}
      >
        {supported ? '❤️ Supported' : '🤍 Support'}
      </button>
      <span data-testid="support-count" className="text-sm text-zinc-500">
        {count} {count === 1 ? 'supporter' : 'supporters'}
      </span>
    </div>
  )
}
