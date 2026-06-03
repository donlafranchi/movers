// T088 — Anonymous signup CTA above the feed (F030). Hidden when authenticated.
import Link from 'next/link'

export function MakeThisYoursBanner({ isAuthenticated }: { isAuthenticated: boolean }) {
  if (isAuthenticated) return null
  return (
    <div
      className="card flex items-center justify-between gap-4 p-4"
      data-testid="signup-cta"
    >
      <div>
        <p className="text-sm font-semibold text-neutral-900">Make this yours</p>
        <p className="text-xs text-neutral-600">
          Sign up to set your home locality and follow what you love.
        </p>
      </div>
      <Link href="/auth/signup?next=/onboarding" className="btn-primary whitespace-nowrap">
        Sign up
      </Link>
    </div>
  )
}
