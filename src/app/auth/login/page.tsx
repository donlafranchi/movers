'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthMethods } from '@/components/AuthMethods'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next')
  const signupHref = next ? `/auth/signup?next=${encodeURIComponent(next)}` : '/auth/signup'
  const initialError = searchParams.get('error')

  const [magicLinkEmail, setMagicLinkEmail] = useState<string | null>(null)

  if (magicLinkEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold mb-3">Check your email</h1>
          <p className="text-sm text-neutral-600 mb-6">
            We sent a sign-in link to <strong>{magicLinkEmail}</strong>. Click the link to log in — no password needed.
          </p>
          <button
            type="button"
            onClick={() => setMagicLinkEmail(null)}
            className="text-sm text-[--color-accent] underline"
          >
            Use a different method
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-5" data-testid="login-heading">
          Welcome back
        </h1>

        {initialError && (
          <p className="mb-4 text-sm text-red-600">{initialError}</p>
        )}

        <AuthMethods
          mode="login"
          next={next}
          onPasswordSuccess={() => router.push(next && next.startsWith('/') ? next : '/')}
          onMagicLinkSent={(email) => setMagicLinkEmail(email)}
        />

        <p className="mt-6 text-sm text-center text-neutral-600">
          Don&apos;t have an account?{' '}
          <Link href={signupHref} className="text-[--color-accent] underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
