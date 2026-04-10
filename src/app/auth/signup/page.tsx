'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { signUp } = useAuth()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSubmitting(true)
    const { error } = await signUp(email, password)
    setSubmitting(false)

    if (error) {
      if (error.message.includes('already registered')) {
        setError('Email already registered. Log in instead.')
      } else {
        setError(error.message)
      }
      return
    }

    router.push('/register-business')
  }

  return (
    <div className="flex min-h-screen items-end justify-center pb-20 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6" data-testid="signup-heading">Create Account</h1>
        <form onSubmit={handleSubmit} data-testid="signup-form">
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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2"
              data-testid="password-input"
            />
            <span className="text-xs text-gray-500">Minimum 8 characters</span>
          </label>
          {error && (
            <p className="text-red-600 text-sm mb-4" data-testid="auth-error">
              {error}{' '}
              {error.includes('Log in') && (
                <Link href="/auth/login" className="underline" data-testid="login-link">
                  Log in
                </Link>
              )}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-foreground text-background py-2 font-medium disabled:opacity-50"
            data-testid="submit-button"
          >
            {submitting ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>
        <p className="mt-4 text-sm text-center">
          Already have an account?{' '}
          <Link href="/auth/login" className="underline">Log in</Link>
        </p>
      </div>
    </div>
  )
}
