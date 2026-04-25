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
        className="btn-secondary !py-2 !px-4 text-sm"
        data-testid="signout-button"
      >
        Sign Out
      </button>
    )
  }

  return (
    <Link
      href="/auth/login"
      className="btn-primary !py-2 !px-4 text-sm"
      data-testid="signin-link"
    >
      Sign In
    </Link>
  )
}
