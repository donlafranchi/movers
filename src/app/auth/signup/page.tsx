'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { EmailFirstSignup } from '@/components/auth/EmailFirstSignup'

export default function SignUpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next')
  // F030: new signups land in onboarding by default; an explicit next
  // (e.g. /register-vendor) overrides.
  const effectiveNext = next ?? '/onboarding'

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-2xl font-semibold" data-testid="signup-heading">
          Sign up or log in
        </h1>
        <p className="mb-5 text-sm text-neutral-600">
          Enter your email — we’ll set you up or sign you in.
        </p>

        <EmailFirstSignup
          next={effectiveNext}
          onAuthenticated={(to) => router.push(to.startsWith('/') ? to : '/onboarding')}
        />

        <p className="mt-6 text-center text-sm text-neutral-600">
          Prefer the classic form?{' '}
          <Link
            href={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}
            className="text-[--color-accent] underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
