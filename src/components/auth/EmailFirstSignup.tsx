// T090 — Email-first signup/login (F030).
//
// A single "enter email" page. On Continue we detect whether the email is
// already registered (email_is_registered RPC):
//   - unknown email   → "Set a password"  (supabase.auth.signUp)
//   - returning email → "Enter password"  (supabase.auth.signInWithPassword)
// Magic-link is the secondary option below the password field on both phases.
//
// Email confirmation: local dev auto-confirms (config.toml
// enable_confirmations=false) so signUp returns a live session → we redirect.
// In production (confirmations on) signUp returns no session → we show the
// "confirm your email" state. Both paths are handled off `data.session`.
'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

type Phase = 'email' | 'new' | 'returning' | 'magic-sent' | 'confirm-email'

interface AuthResult {
  data: { session: unknown | null } | null
  error: { message: string; code?: string; status?: number } | null
}

export interface EmailFirstDeps {
  checkEmailRegistered: (email: string) => Promise<boolean>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>
  signInWithOtp: (email: string, next?: string) => Promise<{ error: { message: string } | null }>
  signInWithGoogle: (next?: string) => Promise<{ error: { message: string } | null }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isAlreadyRegistered(err: { message?: string; code?: string; status?: number } | null) {
  if (!err) return false
  if (err.code === 'user_already_exists') return true
  return /already.*regist|already.*exist|user.*exist/i.test(err.message ?? '')
}

export function EmailFirstSignup({
  next,
  onAuthenticated,
  deps,
}: {
  next?: string | null
  onAuthenticated: (next: string) => void
  deps?: Partial<EmailFirstDeps>
}) {
  const auth = useAuth()
  const d: EmailFirstDeps = {
    checkEmailRegistered: auth.checkEmailRegistered,
    signUp: auth.signUp,
    signInWithPassword: auth.signIn,
    signInWithOtp: auth.signInWithOtp,
    signInWithGoogle: auth.signInWithGoogle,
    ...deps,
  }

  const nextSafe = next && next.startsWith('/') ? next : '/onboarding'

  const [phase, setPhase] = useState<Phase>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset(toPhase: Phase) {
    setError(null)
    setPassword('')
    setPhase(toPhase)
  }

  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      setError('Enter a valid email address.')
      return
    }
    setSubmitting(true)
    try {
      const registered = await d.checkEmailRegistered(value)
      setPhase(registered ? 'returning' : 'new')
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    const { data, error: err } = await d.signUp(email.trim(), password)
    setSubmitting(false)
    if (err) {
      // Race: the email was registered between the check and submit.
      if (isAlreadyRegistered(err)) {
        reset('returning')
        setError('You already have an account — enter your password.')
        return
      }
      setError(err.message)
      return
    }
    // Local auto-confirm → live session → onward. Prod confirmation → no
    // session yet → ask them to confirm their email.
    if (data?.session) onAuthenticated(nextSafe)
    else setPhase('confirm-email')
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!password) {
      setError('Enter your password.')
      return
    }
    setSubmitting(true)
    const { error: err } = await d.signInWithPassword(email.trim(), password)
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    onAuthenticated(nextSafe)
  }

  async function handleMagicLink() {
    setError(null)
    setSubmitting(true)
    const { error: err } = await d.signInWithOtp(email.trim(), nextSafe)
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    setPhase('magic-sent')
  }

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    const { error: err } = await d.signInWithGoogle(nextSafe)
    if (err) {
      setError(err.message)
      setSubmitting(false)
    }
    // OAuth redirect — leave submitting set.
  }

  if (phase === 'magic-sent') {
    return (
      <div className="w-full text-center" data-testid="magic-sent-message">
        <h1 className="mb-3 text-2xl font-semibold">Check your email</h1>
        <p className="mb-6 text-sm text-neutral-600">
          We sent a sign-in link to <strong>{email}</strong>. Click it to finish — no password needed.
        </p>
        <button type="button" onClick={() => reset('email')} className="text-sm text-[--color-accent] underline">
          Use a different email
        </button>
      </div>
    )
  }

  if (phase === 'confirm-email') {
    return (
      <div className="w-full text-center" data-testid="confirm-email-message">
        <h1 className="mb-3 text-2xl font-semibold">Confirm your email</h1>
        <p className="mb-6 text-sm text-neutral-600">
          We sent a confirmation link to <strong>{email}</strong>. Confirm it, then come back to finish setting up.
        </p>
        <button type="button" onClick={() => reset('email')} className="text-sm text-[--color-accent] underline">
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4" data-testid="email-first-signup">
      {phase === 'email' && (
        <>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={submitting}
            data-testid="google-button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
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
          <form onSubmit={handleEmailContinue} className="space-y-3" data-testid="signup-form">
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
            {error && (
              <p data-testid="auth-error" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              data-testid="submit-button"
              className="w-full rounded-full bg-[--color-accent] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[--color-accent-hover] disabled:opacity-50"
            >
              {submitting ? 'Working…' : 'Continue'}
            </button>
          </form>
        </>
      )}

      {(phase === 'new' || phase === 'returning') && (
        <>
          <div className="text-center">
            <h1
              className="text-2xl font-semibold"
              data-testid={phase === 'new' ? 'set-password-heading' : 'enter-password-heading'}
            >
              {phase === 'new' ? 'Set a password' : 'Welcome back'}
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              {phase === 'new' ? 'Creating an account for ' : 'Enter your password for '}
              <strong>{email}</strong>
            </p>
          </div>
          <form
            onSubmit={phase === 'new' ? handleCreateAccount : handleSignIn}
            className="space-y-3"
            data-testid="password-form"
          >
            <input
              type="password"
              required
              autoComplete={phase === 'new' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={phase === 'new' ? 'New password (8+ characters)' : 'Password'}
              className="input"
              data-testid="password-input"
            />
            {error && (
              <p data-testid="auth-error" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              data-testid="submit-button"
              className="w-full rounded-full bg-[--color-accent] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[--color-accent-hover] disabled:opacity-50"
            >
              {submitting ? 'Working…' : phase === 'new' ? 'Create account' : 'Log in'}
            </button>
          </form>

          {/* Magic-link: secondary option below the password field. */}
          <button
            type="button"
            onClick={handleMagicLink}
            disabled={submitting}
            data-testid="magic-link-secondary"
            className="w-full text-xs text-neutral-500 underline hover:text-neutral-700 disabled:opacity-50"
          >
            Sign in with a magic link instead
          </button>
          <button
            type="button"
            onClick={() => reset('email')}
            className="w-full text-xs text-neutral-400 hover:text-neutral-600"
          >
            ← Use a different email
          </button>
        </>
      )}
    </div>
  )
}
