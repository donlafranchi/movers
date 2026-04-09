'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { signIn } = useAuth()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await signIn(email, password)
    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    router.push('/')
  }

  return (
    <div className="flex min-h-screen items-end justify-center pb-20 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6" data-testid="login-heading">Log In</h1>
        <form onSubmit={handleSubmit} data-testid="login-form">
          <label className="block mb-4">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2"
              data-testid="email-input"
            />
          </label>
          <label className="block mb-4">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2"
              data-testid="password-input"
            />
          </label>
          {error && (
            <p className="text-red-600 text-sm mb-4" data-testid="auth-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-foreground text-background py-2 font-medium disabled:opacity-50"
            data-testid="submit-button"
          >
            {submitting ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        <p className="mt-4 text-sm text-center">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="underline">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
