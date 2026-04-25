'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

/**
 * Auth-aware CTAs. Shows "Log in" + "Become a vendor" when signed out;
 * hides itself when signed in (the normal nav handles that case).
 */
export function AuthCtaButtons({ variant = 'default' }: { variant?: 'default' | 'compact' }) {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [hasVendor, setHasVendor] = useState<boolean>(false)

  useEffect(() => {
    const client = supabase()
    const checkVendor = async (uid: string | undefined) => {
      if (!uid) { setHasVendor(false); return }
      const { data } = await client.from('businesses').select('id').eq('user_id', uid).limit(1).maybeSingle()
      setHasVendor(!!data)
    }
    client.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user)
      checkVendor(data.user?.id)
    })
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session?.user)
      checkVendor(session?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (authed === null) return null

  if (authed) {
    if (hasVendor) return null
    return (
      <Link href="/join" className="text-sm font-medium text-neutral-700 hover:text-neutral-900">
        List your business <span aria-hidden>→</span>
      </Link>
    )
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <Link href="/auth/login" className="text-sm text-neutral-700 hover:text-neutral-900 px-2">
          Log in
        </Link>
        <Link
          href="/auth/signup"
          data-testid="signup-link"
          className="inline-flex items-center rounded-full bg-[--color-accent] px-3 py-1.5 text-sm font-medium text-white hover:bg-[--color-accent-hover]"
        >
          Sign up
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <Link
        href="/join"
        className="text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        List your business <span aria-hidden>→</span>
      </Link>
      <Link href="/auth/login" className="text-sm font-medium text-neutral-700 hover:text-neutral-900">
        Log in
      </Link>
      <Link
        href="/auth/signup"
        data-testid="signup-link"
        className="inline-flex items-center rounded-full bg-[--color-accent] px-4 py-2 text-sm font-semibold text-white hover:bg-[--color-accent-hover] shadow-sm"
      >
        Sign up
      </Link>
    </div>
  )
}
