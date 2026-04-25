'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Market, WeekdaySlug } from '@/lib/types'

const DAYS: { slug: WeekdaySlug; label: string }[] = [
  { slug: 'mon', label: 'Mon' }, { slug: 'tue', label: 'Tue' }, { slug: 'wed', label: 'Wed' },
  { slug: 'thu', label: 'Thu' }, { slug: 'fri', label: 'Fri' }, { slug: 'sat', label: 'Sat' }, { slug: 'sun', label: 'Sun' },
]

interface Props {
  market?: Market
}

export function MarketForm({ market }: Props) {
  const router = useRouter()
  const [name, setName] = useState(market?.name ?? '')
  const [slug, setSlug] = useState(market?.slug ?? '')
  const [city, setCity] = useState(market?.city ?? '')
  const [state, setState] = useState(market?.state ?? '')
  const [latitude, setLatitude] = useState(market?.latitude?.toString() ?? '')
  const [longitude, setLongitude] = useState(market?.longitude?.toString() ?? '')
  const [days, setDays] = useState<WeekdaySlug[]>(market?.schedule_days ?? [])
  const [startTime, setStartTime] = useState(market?.schedule_start_time ?? '')
  const [endTime, setEndTime] = useState(market?.schedule_end_time ?? '')
  const [description, setDescription] = useState(market?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geoQuery, setGeoQuery] = useState('')
  const [geoResults, setGeoResults] = useState<{ name: string; latitude: number; longitude: number }[]>([])

  function toggleDay(d: WeekdaySlug) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  async function lookup() {
    if (!geoQuery.trim()) return
    const r = await fetch(`/api/admin/geocode?q=${encodeURIComponent(geoQuery)}`)
    const data = await r.json()
    setGeoResults(data.results ?? [])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await fetch('/api/admin/markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: market?.id,
        name, slug, city, state,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        schedule_days: days,
        schedule_start_time: startTime,
        schedule_end_time: endTime,
        description,
      }),
    })
    setBusy(false)
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setError(d.error ?? 'failed')
      return
    }
    router.push('/admin/markets')
    router.refresh()
  }

  async function del() {
    if (!market || !confirm(`Delete ${market.name}?`)) return
    await fetch(`/api/admin/markets?id=${market.id}`, { method: 'DELETE' })
    router.push('/admin/markets')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Slug"><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} required /></Field>
        <Field label="City"><input className="input" value={city} onChange={(e) => setCity(e.target.value)} required /></Field>
        <Field label="State"><input className="input" value={state} onChange={(e) => setState(e.target.value)} required maxLength={2} /></Field>
      </div>

      <div className="rounded-lg border border-neutral-200 p-3">
        <div className="mb-2 text-xs font-medium text-neutral-600">Geocode helper</div>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="e.g. 1234 Main St, Folsom CA" value={geoQuery} onChange={(e) => setGeoQuery(e.target.value)} />
          <button type="button" onClick={lookup} className="btn-secondary text-sm">Lookup</button>
        </div>
        {geoResults.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {geoResults.map((g, i) => (
              <li key={i}>
                <button type="button" onClick={() => { setLatitude(String(g.latitude)); setLongitude(String(g.longitude)); setGeoResults([]) }} className="text-left text-[var(--color-accent)] hover:underline">
                  {g.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude"><input className="input" value={latitude} onChange={(e) => setLatitude(e.target.value)} required /></Field>
        <Field label="Longitude"><input className="input" value={longitude} onChange={(e) => setLongitude(e.target.value)} required /></Field>
      </div>

      <div>
        <label className="text-xs font-medium text-neutral-600">Schedule days</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button key={d.slug} type="button" onClick={() => toggleDay(d.slug)} className={days.includes(d.slug) ? 'chip-selected' : 'chip'}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start time"><input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
        <Field label="End time"><input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
      </div>

      <Field label="Description"><textarea className="input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Saving…' : market ? 'Save' : 'Create'}</button>
        {market && <button type="button" onClick={del} className="text-sm text-red-600 hover:underline">Delete</button>}
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
