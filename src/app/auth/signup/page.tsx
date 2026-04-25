'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthMethods } from '@/components/AuthMethods'

export default function SignUpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next')
  const loginHref = next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'

  const [magicLinkEmail, setMagicLinkEmail] = useState<string | null>(null)

  if (magicLinkEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center" data-testid="confirmation-message">
          <h1 className="text-2xl font-semibold mb-3">Check your email</h1>
          <p className="text-sm text-neutral-600 mb-6">
            We sent a sign-in link to <strong>{magicLinkEmail}</strong>. Click the link to finish signing up — no password needed.
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
        <h1 className="text-2xl font-semibold mb-2" data-testid="signup-heading">
          Create your account
        </h1>
        {next === '/register-vendor' && (
          <p className="text-sm text-neutral-600 mb-5">
            One account gets you a free vendor listing. Takes about 90 seconds after you sign up.
          </p>
        )}
        {next !== '/register-vendor' && (
          <p className="text-sm text-neutral-600 mb-5">Follow vendors and save your local market.</p>
        )}

        <AuthMethods
          mode="signup"
          next={next}
          onPasswordSuccess={() => router.push(next && next.startsWith('/') ? next : '/')}
          onMagicLinkSent={(email) => setMagicLinkEmail(email)}
        />

        <p className="mt-6 text-sm text-center text-neutral-600">
          Already have an account?{' '}
          <Link href={loginHref} className="text-[--color-accent] underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
