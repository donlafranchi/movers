'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  mode: 'signup' | 'login'
  next?: string | null
  onPasswordSuccess?: () => void
  onMagicLinkSent?: (email: string) => void
}

export function AuthMethods({ mode, next, onPasswordSuccess, onMagicLinkSent }: Props) {
  const { signUp, signIn, signInWithOtp, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextSafe = next && next.startsWith('/') ? next : null

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    const { error } = await signInWithGoogle(nextSafe ?? undefined)
    if (error) {
      setError(error.message)
      setSubmitting(false)
    }
    // OAuth redirect — no need to clear submitting
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email) {
      setError('Enter your email first')
      return
    }
    setSubmitting(true)
    const { error } = await signInWithOtp(email, nextSafe ?? undefined)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    onMagicLinkSent?.(email)
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !password) {
      setError('Email and password are required')
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setSubmitting(true)
    const fn = mode === 'signup' ? signUp : signIn
    const { error } = await fn(email, password)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    onPasswordSuccess?.()
  }

  return (
    <div className="w-full space-y-4">
      <button
        type="button"
        onClick={handleGoogle}
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white py-2.5 px-4 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-neutral-500">or</span>
        </div>
      </div>

      <form onSubmit={showPassword ? handlePassword : handleMagicLink} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="input"
          data-testid="email-input"
        />

        {showPassword && (
          <input
            type="password"
            required
            minLength={mode === 'signup' ? 8 : undefined}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'New password (8+ chars)' : 'Password'}
            className="input"
            data-testid="password-input"
          />
        )}

        {error && (
          <p data-testid="auth-error" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          data-testid="submit-button"
          className="w-full rounded-full bg-[--color-accent] text-white py-2.5 px-4 text-sm font-semibold hover:bg-[--color-accent-hover] disabled:opacity-50"
        >
          {submitting
            ? 'Working…'
            : showPassword
              ? mode === 'signup'
                ? 'Create account'
                : 'Log in'
              : 'Send magic link'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setShowPassword((v) => !v)
          setError(null)
        }}
        className="w-full text-xs text-neutral-500 hover:text-neutral-700 underline"
      >
        {showPassword ? 'Use magic link instead (no password)' : 'Use email + password instead'}
      </button>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
