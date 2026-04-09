'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

export function AuthButton() {
  const { user, loading, signOut } = useAuth()

  if (loading) return null

  if (user) {
    return (
      <button
        onClick={() => signOut()}
        className="text-sm px-3 py-1 rounded border"
        data-testid="signout-button"
      >
        Sign Out
      </button>
    )
  }

  return (
    <Link
      href="/auth/login"
      className="text-sm px-3 py-1 rounded border"
      data-testid="signin-link"
    >
      Sign In
    </Link>
  )
}
