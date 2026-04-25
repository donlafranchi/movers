'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { createBrowserClient } from '@supabase/ssr'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export default function JoinPage() {
  const [url, setUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const target = `${origin}/register-vendor`
    setUrl(target)
    QRCode.toDataURL(target, { width: 600, margin: 2, color: { dark: '#064e3b' } }).then(setQrDataUrl)

    const client = supabase()
    client.auth.getUser().then(({ data }) => setAuthed(!!data.user))
  }, [])

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="min-h-screen bg-white pb-32 md:pb-24">
      {/* Hero */}
      <section className="px-6 pt-12 md:pt-20 pb-10 max-w-3xl mx-auto text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-accent] font-semibold">For vendors</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold text-neutral-900 leading-tight">
          Sell at a farmers market? Get listed free.
        </h1>
        <p className="mt-4 text-lg text-neutral-700 max-w-xl mx-auto">
          Main Street helps the customers you meet at the market find you the other six days of the week.
          No fees. No middlemen. Just visibility for independent makers and farmers.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/register-vendor"
            className="inline-flex items-center justify-center rounded-full bg-[--color-accent] px-6 py-3 text-base font-semibold text-white hover:bg-[--color-accent-hover] shadow-sm"
          >
            {authed ? 'List my booth →' : 'Sign up as a vendor →'}
          </Link>
          {!authed && (
            <Link
              href="/auth/login?next=/register-vendor"
              className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-6 py-3 text-base font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              Already a member? Log in
            </Link>
          )}
        </div>
      </section>

      {/* Why */}
      <section className="px-6 py-10 bg-neutral-50">
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <Benefit
            title="Followable between markets"
            body="Customers who love what you made on Saturday can find you on Wednesday."
          />
          <Benefit
            title="Free forever for vendors"
            body="No listing fees, no transaction fees, no paid placement. The platform is supported by consumers."
          />
          <Benefit
            title="Local-first audience"
            body="People on Main Street already want to spend locally. You're not marketing to strangers — you're being introduced."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-12 max-w-3xl mx-auto">
        <h2 className="text-2xl font-semibold text-neutral-900 text-center">How it works</h2>
        <ol className="mt-6 space-y-5">
          <Step n={1} title="Create a free account" body="Email and password. Takes 10 seconds." />
          <Step
            n={2}
            title="Tell customers who you are"
            body="Your name, a tagline, what you make, and which markets you attend. About 90 seconds."
          />
          <Step
            n={3}
            title="Your profile goes live"
            body="You're immediately in the feed, the map, and searchable by product."
          />
          <Step
            n={4}
            title="Customers follow you"
            body="They get updates when you'll be at an upcoming market. No more 'I forgot your name.'"
          />
        </ol>

        <div className="mt-8 text-center">
          <Link
            href="/register-vendor"
            className="inline-flex items-center justify-center rounded-full bg-[--color-accent] px-6 py-3 text-base font-semibold text-white hover:bg-[--color-accent-hover]"
          >
            {authed ? 'List my booth →' : 'Start my listing →'}
          </Link>
        </div>
      </section>

      {/* Share */}
      <section className="px-6 py-12 bg-neutral-50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-semibold text-neutral-900">Share with another vendor</h2>
          <p className="mt-2 text-neutral-700">
            Know someone at the market who should be on here? Send them this link or let them scan the code.
          </p>

          <div className="mt-6 flex flex-col items-center gap-4">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Scan to sign up as a vendor" className="w-56 h-56" />
            ) : (
              <div className="w-56 h-56 bg-neutral-100 animate-pulse rounded-lg" />
            )}

            <a href={url || '#'} className="text-sm text-[--color-accent] underline break-all max-w-full">
              {url || 'Loading…'}
            </a>

            <button
              type="button"
              onClick={copy}
              disabled={!url}
              className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

function Benefit({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5">
      <h3 className="font-semibold text-neutral-900">{title}</h3>
      <p className="mt-2 text-sm text-neutral-600 leading-relaxed">{body}</p>
    </div>
  )
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-accent] text-white text-sm font-semibold flex items-center justify-center">
        {n}
      </div>
      <div>
        <p className="font-semibold text-neutral-900">{title}</p>
        <p className="text-sm text-neutral-600 mt-1">{body}</p>
      </div>
    </li>
  )
}
