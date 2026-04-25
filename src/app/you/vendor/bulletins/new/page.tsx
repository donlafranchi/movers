'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export default function NewBulletinPage() {
  const router = useRouter()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorName, setVendorName] = useState<string>('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace('/auth/login?next=/you/vendor/bulletins/new')
        return
      }
      const { data: vendor } = await client
        .from('businesses')
        .select('id, name')
        .eq('user_id', data.user.id)
        .limit(1)
        .maybeSingle()
      if (!vendor) {
        router.replace('/join')
        return
      }
      setVendorId(vendor.id)
      setVendorName(vendor.name)
    })
  }, [router])

  const publish = async () => {
    if (!vendorId || !body.trim()) return
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/vendor/bulletins/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendorId, title: title.trim() || null, body: body.trim() }),
    })
    const json = await res.json()
    if (!res.ok) {
      setSubmitting(false)
      setError(json.message ?? json.error ?? 'Failed to publish')
      return
    }
    router.replace('/you/vendor/bulletins')
  }

  return (
    <main className="pb-24 max-w-2xl mx-auto p-4" data-testid="new-bulletin-page">
      <Link href="/you/vendor/bulletins" className="text-sm text-[--color-accent] hover:underline">
        ← Back to bulletins
      </Link>
      <h1 className="text-2xl font-semibold mt-3">New Bulletin</h1>
      <p className="text-sm text-neutral-600 mt-1">
        Publishing as <span className="font-medium">{vendorName || '…'}</span>. Sent to all your active followers.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wide font-semibold text-neutral-500">Title (optional)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's the headline?"
            data-testid="bulletin-title"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-accent]"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide font-semibold text-neutral-500">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="What do you want followers to know? Plain text only — markdown is coming later."
            data-testid="bulletin-body"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-accent]"
          />
        </div>

        {body.trim() && (
          <div data-testid="bulletin-preview">
            <p className="text-xs uppercase tracking-wide font-semibold text-neutral-500">Preview</p>
            <div className="mt-2 card p-4">
              <p className="text-xs font-semibold text-[--color-accent]">{vendorName}</p>
              {title.trim() && <h3 className="text-sm font-semibold text-neutral-900 mt-1">{title}</h3>}
              <p className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{body}</p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600" data-testid="bulletin-error">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={publish}
            disabled={!body.trim() || submitting || !vendorId}
            data-testid="bulletin-publish"
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Publishing…' : 'Publish'}
          </button>
          <Link href="/you/vendor/bulletins" className="btn-secondary">Cancel</Link>
        </div>
      </div>
    </main>
  )
}
