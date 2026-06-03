import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { EmailFirstSignup, type EmailFirstDeps } from './EmailFirstSignup'

// T090 — email-first signup/login flow against injected auth deps.

afterEach(() => cleanup())

// useAuth runs in the component (for default deps). Stub the hook so the
// real Supabase client is never constructed; injected `deps` win anyway.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    checkEmailRegistered: vi.fn(),
    signUp: vi.fn(),
    signIn: vi.fn(),
    signInWithOtp: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}))

function makeDeps(over: Partial<EmailFirstDeps> = {}): EmailFirstDeps {
  return {
    checkEmailRegistered: vi.fn(async () => false),
    signUp: vi.fn(async () => ({ data: { session: {} }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { session: {} }, error: null })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    signInWithGoogle: vi.fn(async () => ({ error: null })),
    ...over,
  }
}

function fillEmail(value: string) {
  fireEvent.change(screen.getByTestId('email-input'), { target: { value } })
}
function clickSubmit() {
  fireEvent.click(screen.getByTestId('submit-button'))
}

describe('T090 — EmailFirstSignup', () => {
  it('starts on the email step', () => {
    render(<EmailFirstSignup onAuthenticated={vi.fn()} deps={makeDeps()} />)
    expect(screen.getByTestId('email-input')).toBeInTheDocument()
    expect(screen.queryByTestId('password-input')).toBeNull()
  })

  it('rejects a malformed email before any lookup', async () => {
    // `a@b` clears the native type=email check but fails our stricter regex
    // (no domain dot) — exercises the JS-side backstop.
    const deps = makeDeps()
    render(<EmailFirstSignup onAuthenticated={vi.fn()} deps={deps} />)
    fillEmail('a@b')
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('auth-error')).toHaveTextContent(/valid email/i))
    expect(deps.checkEmailRegistered).not.toHaveBeenCalled()
  })

  it('unknown email → "set a password" (sign up); session → onAuthenticated(next)', async () => {
    const onAuthenticated = vi.fn()
    const deps = makeDeps({ checkEmailRegistered: vi.fn(async () => false) })
    render(<EmailFirstSignup next="/onboarding" onAuthenticated={onAuthenticated} deps={deps} />)
    fillEmail('new@example.test')
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('set-password-heading')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'supersecret' } })
    clickSubmit()
    await waitFor(() => expect(deps.signUp).toHaveBeenCalledWith('new@example.test', 'supersecret'))
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/onboarding'))
  })

  it('rejects a weak password on the set-password step', async () => {
    const deps = makeDeps({ checkEmailRegistered: vi.fn(async () => false) })
    render(<EmailFirstSignup onAuthenticated={vi.fn()} deps={deps} />)
    fillEmail('new@example.test')
    clickSubmit()
    await waitFor(() => screen.getByTestId('set-password-heading'))
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'short' } })
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('auth-error')).toHaveTextContent(/at least 8/i))
    expect(deps.signUp).not.toHaveBeenCalled()
  })

  it('no session after signUp → "confirm your email" (prod confirmation path)', async () => {
    const onAuthenticated = vi.fn()
    const deps = makeDeps({
      checkEmailRegistered: vi.fn(async () => false),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    })
    render(<EmailFirstSignup onAuthenticated={onAuthenticated} deps={deps} />)
    fillEmail('new@example.test')
    clickSubmit()
    await waitFor(() => screen.getByTestId('set-password-heading'))
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'supersecret' } })
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('confirm-email-message')).toBeInTheDocument())
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('returning email → "enter password" (sign in)', async () => {
    const onAuthenticated = vi.fn()
    const deps = makeDeps({ checkEmailRegistered: vi.fn(async () => true) })
    render(<EmailFirstSignup next="/" onAuthenticated={onAuthenticated} deps={deps} />)
    fillEmail('existing@example.test')
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('enter-password-heading')).toBeInTheDocument())
    expect(screen.queryByTestId('set-password-heading')).toBeNull()

    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'mypassword' } })
    clickSubmit()
    await waitFor(() =>
      expect(deps.signInWithPassword).toHaveBeenCalledWith('existing@example.test', 'mypassword'),
    )
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/'))
  })

  it('signUp "already registered" race falls back to the enter-password step', async () => {
    const deps = makeDeps({
      checkEmailRegistered: vi.fn(async () => false),
      signUp: vi.fn(async () => ({
        data: null,
        error: { message: 'User already registered', code: 'user_already_exists' },
      })),
    })
    render(<EmailFirstSignup onAuthenticated={vi.fn()} deps={deps} />)
    fillEmail('race@example.test')
    clickSubmit()
    await waitFor(() => screen.getByTestId('set-password-heading'))
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'supersecret' } })
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('enter-password-heading')).toBeInTheDocument())
  })

  it('magic-link is a secondary option on the password step', async () => {
    const deps = makeDeps({ checkEmailRegistered: vi.fn(async () => true) })
    render(<EmailFirstSignup onAuthenticated={vi.fn()} deps={deps} />)
    fillEmail('existing@example.test')
    clickSubmit()
    await waitFor(() => screen.getByTestId('enter-password-heading'))
    fireEvent.click(screen.getByTestId('magic-link-secondary'))
    await waitFor(() => expect(deps.signInWithOtp).toHaveBeenCalledWith('existing@example.test', '/onboarding'))
    await waitFor(() => expect(screen.getByTestId('magic-sent-message')).toBeInTheDocument())
  })

  it('surfaces a sign-in error without advancing', async () => {
    const onAuthenticated = vi.fn()
    const deps = makeDeps({
      checkEmailRegistered: vi.fn(async () => true),
      signInWithPassword: vi.fn(async () => ({ data: null, error: { message: 'Invalid login credentials' } })),
    })
    render(<EmailFirstSignup onAuthenticated={onAuthenticated} deps={deps} />)
    fillEmail('existing@example.test')
    clickSubmit()
    await waitFor(() => screen.getByTestId('enter-password-heading'))
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'wrong' } })
    clickSubmit()
    await waitFor(() => expect(screen.getByTestId('auth-error')).toHaveTextContent(/invalid/i))
    expect(onAuthenticated).not.toHaveBeenCalled()
  })
})
