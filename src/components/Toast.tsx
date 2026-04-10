'use client'

import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  visible: boolean
  onHide: () => void
  duration?: number
}

export function Toast({ message, visible, onHide, duration = 2000 }: ToastProps) {
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(onHide, duration)
    return () => clearTimeout(timer)
  }, [visible, onHide, duration])

  if (!visible) return null

  return (
    <div
      data-testid="toast"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-zinc-800 text-white px-4 py-2 rounded-full text-sm shadow-lg z-50"
    >
      {message}
    </div>
  )
}
