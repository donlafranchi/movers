'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function YouPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasVendor, setHasVendor] = useState(false)
  const [emailsEnabled, setEmailsEnabled] = useState(true)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data }) => {
      const user = data.user
      if (!user) {
        setLoaded(true)
        return
      }
      setEmail(user.email ?? null)
      const [{ data: vendor }, { data: prefs }] = await Promise.all([
        client.from('businesses').select('slug').eq('user_id', user.id).maybeSingle(),
        client.from('user_preferences').select('follow_emails_enabled').eq('user_id', user.id).maybeSingle(),
      ])
      setHasVendor(!!vendor)
      setEmailsEnabled(prefs?.follow_emails_enabled ?? true)
      setLoaded(true)
    })
  }, [])

  const toggleEmails = async () => {
    const client = supabase()
    const { data } = await client.auth.getUser()
    const uid = data.user?.id
    if (!uid) return
    const next = !emailsEnabled
    setEmailsEnabled(next)
    await client
      .from('user_preferences')
      .upsert({ user_id: uid, follow_emails_enabled: next, updated_at: new Date().toISOString() })
  }

  const signOut = async () => {
    const client = supabase()
    await client.auth.signOut()
    window.location.href = '/'
  }

  if (!loaded) return <main className="p-4 pb-24">Loading…</main>

  if (!email) {
    return (
      <main className="p-6 pb-24 max-w-md mx-auto text-center">
        <h1 className="text-xl font-semibold">You</h1>
        <p className="mt-3 text-neutral-600 text-sm">Sign in or create an account.</p>
        <div className="mt-4 flex gap-2 justify-center">
          <Link href="/auth/signup" className="bg-emerald-700 text-white rounded-md px-4 py-2 text-sm font-medium">
            Sign Up
          </Link>
          <Link href="/auth/login" className="border border-neutral-300 rounded-md px-4 py-2 text-sm font-medium">
            Log In
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="pb-24 max-w-md mx-auto p-4">
      <h1 className="text-xl font-semibold">You</h1>
      <p className="text-sm text-neutral-600 mt-1">{email}</p>

      <div className="mt-6 space-y-2">
        <Link href="/following" className="block bg-white border border-neutral-200 rounded-lg px-4 py-3 text-sm font-medium hover:border-neutral-400">
          Vendors I follow
        </Link>
        {hasVendor ? (
          <Link href="/register-business" className="block bg-white border border-neutral-200 rounded-lg px-4 py-3 text-sm font-medium hover:border-neutral-400">
            My vendor listing
          </Link>
        ) : (
          <Link href="/register-business" className="block bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
            Register your vendor listing
          </Link>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">Notifications</h2>
        <label className="flex items-center justify-between bg-white border border-neutral-200 rounded-lg px-4 py-3 text-sm">
          <span>Email me when followed vendors are at upcoming markets</span>
          <input type="checkbox" checked={emailsEnabled} onChange={toggleEmails} className="h-4 w-4" />
        </label>
      </div>

      <button
        onClick={signOut}
        className="mt-8 w-full text-sm text-neutral-600 underline"
      >
        Sign out
      </button>
    </main>
  )
}
