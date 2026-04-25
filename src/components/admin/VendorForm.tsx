'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CATEGORIES, CATEGORY_ORDER, type CategorySlug } from '@/lib/categories'
import type { Vendor, Market, OwnershipTier } from '@/lib/types'

const TIERS: OwnershipTier[] = ['independent', 'coop', 'local-franchise', 'challenger', 'mission-driven', 'pe-corporate']

interface Props {
  vendor: Vendor
  markets: Market[]
  initialMarketIds: string[]
  initialCategorySlugs: CategorySlug[]
  initialPrimary: CategorySlug | null
}

export function VendorForm({ vendor, markets, initialMarketIds, initialCategorySlugs, initialPrimary }: Props) {
  const router = useRouter()
  const [v, setV] = useState({
    name: vendor.name,
    slug: vendor.slug,
    tagline: vendor.tagline ?? '',
    story: vendor.story ?? '',
    street_address: vendor.street_address,
    city: vendor.city,
    state: vendor.state,
    zip: vendor.zip,
    latitude: vendor.latitude?.toString() ?? '',
    longitude: vendor.longitude?.toString() ?? '',
    ownership_tier: vendor.ownership_tier as OwnershipTier,
    cover_photo_url: vendor.cover_photo_url ?? '',
    website_url: vendor.website_url ?? '',
    instagram_handle: vendor.instagram_handle ?? '',
    contact_email: vendor.contact_email ?? '',
    is_featured: !!vendor.is_featured,
  })
  const [marketIds, setMarketIds] = useState<string[]>(initialMarketIds)
  const [cats, setCats] = useState<CategorySlug[]>(initialCategorySlugs)
  const [primary, setPrimary] = useState<CategorySlug | null>(initialPrimary)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geoQuery, setGeoQuery] = useState('')
  const [geoResults, setGeoResults] = useState<{ name: string; latitude: number; longitude: number }[]>([])

  function set<K extends keyof typeof v>(k: K, val: typeof v[K]) {
    setV((prev) => ({ ...prev, [k]: val }))
  }

  function toggleMarket(id: string) {
    setMarketIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  function toggleCategory(slug: CategorySlug) {
    setCats((prev) => {
      const next = prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]
      if (primary && !next.includes(primary)) setPrimary(next[0] ?? null)
      if (!primary && next.length > 0) setPrimary(next[0])
      return next
    })
  }

  async function lookup() {
    if (!geoQuery.trim()) return
    const r = await fetch(`/api/admin/geocode?q=${encodeURIComponent(geoQuery)}`)
    const data = await r.json()
    setGeoResults(data.results ?? [])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await fetch('/api/admin/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: vendor.id,
        ...v,
        category: primary ?? v.ownership_tier,
        market_ids: marketIds,
        category_slugs: cats,
        primary_category: primary,
      }),
    })
    setBusy(false)
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setError(d.error ?? 'failed')
      return
    }
    router.refresh()
  }

  async function del() {
    if (!confirm(`Delete ${vendor.name}? This is permanent.`)) return
    await fetch(`/api/admin/vendors?id=${vendor.id}`, { method: 'DELETE' })
    router.push('/admin/vendors')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="Identity">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label="Slug"><input className="input" value={v.slug} onChange={(e) => set('slug', e.target.value)} required /></Field>
          <Field label="Tagline" full><input className="input" value={v.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        </div>
        <Field label="Story"><textarea className="input min-h-32" value={v.story} onChange={(e) => set('story', e.target.value)} /></Field>
      </Section>

      <Section title="Address">
        <div className="rounded-lg border border-neutral-200 p-3">
          <div className="mb-2 text-xs font-medium text-neutral-600">Geocode helper</div>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="full address" value={geoQuery} onChange={(e) => setGeoQuery(e.target.value)} />
            <button type="button" onClick={lookup} className="btn-secondary text-sm">Lookup</button>
          </div>
          {geoResults.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {geoResults.map((g, i) => (
                <li key={i}>
                  <button type="button" onClick={() => { set('latitude', String(g.latitude)); set('longitude', String(g.longitude)); setGeoResults([]) }} className="text-left text-[var(--color-accent)] hover:underline">
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Street" full><input className="input" value={v.street_address} onChange={(e) => set('street_address', e.target.value)} /></Field>
          <Field label="City"><input className="input" value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="State"><input className="input" value={v.state} onChange={(e) => set('state', e.target.value)} maxLength={2} /></Field>
          <Field label="Zip"><input className="input" value={v.zip} onChange={(e) => set('zip', e.target.value)} /></Field>
          <Field label="Latitude"><input className="input" value={v.latitude} onChange={(e) => set('latitude', e.target.value)} /></Field>
          <Field label="Longitude"><input className="input" value={v.longitude} onChange={(e) => set('longitude', e.target.value)} /></Field>
        </div>
      </Section>

      <Section title="Categories & ownership">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((slug) => (
            <button key={slug} type="button" onClick={() => toggleCategory(slug)} className={cats.includes(slug) ? 'chip-selected' : 'chip'}>
              {CATEGORIES[slug].emoji} {CATEGORIES[slug].label}
            </button>
          ))}
        </div>
        {cats.length > 1 && (
          <div className="mt-2">
            <label className="text-xs font-medium text-neutral-600">Primary category</label>
            <select className="input mt-1" value={primary ?? ''} onChange={(e) => setPrimary(e.target.value as CategorySlug)}>
              {cats.map((c) => <option key={c} value={c}>{CATEGORIES[c].label}</option>)}
            </select>
          </div>
        )}
        <Field label="Ownership tier">
          <select className="input" value={v.ownership_tier} onChange={(e) => set('ownership_tier', e.target.value as OwnershipTier)}>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Markets">
        <div className="grid grid-cols-2 gap-2">
          {markets.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={marketIds.includes(m.id)} onChange={() => toggleMarket(m.id)} />
              {m.name} <span className="text-xs text-neutral-500">— {m.city}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Links & contact">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Website URL"><input className="input" value={v.website_url} onChange={(e) => set('website_url', e.target.value)} /></Field>
          <Field label="Instagram handle (no @)"><input className="input" value={v.instagram_handle} onChange={(e) => set('instagram_handle', e.target.value)} /></Field>
          <Field label="Contact email"><input className="input" type="email" value={v.contact_email} onChange={(e) => set('contact_email', e.target.value)} /></Field>
          <Field label="Cover photo URL"><input className="input" value={v.cover_photo_url} onChange={(e) => set('cover_photo_url', e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />
          Featured vendor
        </label>
      </Section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={del} className="text-sm text-red-600 hover:underline">Delete vendor</button>
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
