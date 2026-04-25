'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { geocode } from '@/lib/geocoding'
import { uniqueSlug } from '@/lib/slugify'
import { createClient } from '@/lib/supabase'
import { CATEGORIES, CATEGORY_ORDER, type CategorySlug } from '@/lib/categories'
import type { Market } from '@/lib/types'

interface FormErrors {
  name?: string
  tagline?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  categories?: string
  markets?: string
}

export default function RegisterVendorPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [availableMarkets, setAvailableMarkets] = useState<Market[]>([])
  const [existingVendorSlug, setExistingVendorSlug] = useState<string | null>(null)

  // Identity
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')

  // Location
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')

  // Category + markets
  const [selectedCategories, setSelectedCategories] = useState<CategorySlug[]>([])
  const [primaryCategory, setPrimaryCategory] = useState<CategorySlug | null>(null)
  const [selectedMarketIds, setSelectedMarketIds] = useState<string[]>([])

  // Content + links
  const [story, setStory] = useState('')
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [instagramHandle, setInstagramHandle] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/auth/signup?next=${encodeURIComponent('/register-vendor')}`)
      return
    }
    if (!user) return
    const supabase = createClient()
    supabase
      .from('markets')
      .select('*')
      .order('name')
      .then(({ data }) => setAvailableMarkets((data ?? []) as Market[]))
    supabase
      .from('businesses')
      .select('slug')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.slug) setExistingVendorSlug(data.slug as string)
      })
  }, [authLoading, user, router])

  function toggleCategory(slug: CategorySlug) {
    setSelectedCategories((prev) => {
      const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
      if (!next.includes(primaryCategory as CategorySlug)) {
        setPrimaryCategory(next[0] ?? null)
      } else if (!primaryCategory && next.length > 0) {
        setPrimaryCategory(next[0])
      }
      return next
    })
  }

  function toggleMarket(id: string) {
    setSelectedMarketIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  function validate(): FormErrors {
    const e: FormErrors = {}
    if (!name.trim()) e.name = 'Vendor name is required'
    if (!tagline.trim()) e.tagline = 'A one-line tagline is required'
    else if (tagline.length > 120) e.tagline = 'Tagline must be 120 characters or less'
    if (!street.trim()) e.street = 'Street is required'
    if (!city.trim()) e.city = 'City is required'
    if (!state.trim()) e.state = 'State is required'
    if (!zip.trim()) e.zip = 'ZIP is required'
    if (selectedCategories.length === 0) e.categories = 'Pick at least one category'
    if (selectedMarketIds.length === 0) e.markets = 'Pick at least one market where you sell'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const fieldErrors = validate()
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    setSubmitting(true)

    const fullAddress = `${street}, ${city}, ${state} ${zip}`
    const results = await geocode(fullAddress)
    if (results.length === 0) {
      setFormError('We could not find this address on the map. Double-check and try again.')
      setSubmitting(false)
      return
    }
    const [longitude, latitude] = results[0].coordinates
    const slug = await uniqueSlug(name)
    const supabase = createClient()

    const vendorRecord = {
      user_id: user!.id,
      name: name.trim(),
      slug,
      street_address: street.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      latitude,
      longitude,
      category: primaryCategory ?? selectedCategories[0],
      ownership_tier: 'independent' as const,
      story: story.trim() || null,
      tagline: tagline.trim(),
      cover_photo_url: coverPhotoUrl.trim() || null,
      website_url: websiteUrl.trim() || null,
      instagram_handle: instagramHandle.trim().replace(/^@/, '') || null,
      contact_email: contactEmail.trim() || null,
      metadata: {},
    }

    const { data: inserted, error } = await supabase
      .from('businesses')
      .insert(vendorRecord)
      .select('id, slug')
      .single()

    if (error || !inserted) {
      setFormError(error?.message ?? 'Something went wrong. Try again.')
      setSubmitting(false)
      return
    }

    const vendorId = inserted.id as string

    const categoryRows = selectedCategories.map((cat) => ({
      vendor_id: vendorId,
      category_slug: cat,
      is_primary: cat === primaryCategory,
    }))
    const marketRows = selectedMarketIds.map((mid) => ({ vendor_id: vendorId, market_id: mid }))

    const [catRes, mvRes] = await Promise.all([
      supabase.from('vendor_categories').insert(categoryRows),
      supabase.from('market_vendors').insert(marketRows),
    ])

    if (catRes.error || mvRes.error) {
      setFormError('Listing created but some details failed to save. Edit your listing to retry.')
      router.push(`/vendors/${inserted.slug}`)
      return
    }

    router.push(`/vendors/${inserted.slug}`)
  }

  if (authLoading) return null

  if (existingVendorSlug) {
    return (
      <div className="min-h-screen px-4 py-12">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-xl font-semibold">You already have a vendor listing</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Each account can have one listing. Editing and deletion are coming soon — for now, reach out if you need changes.
          </p>
          <a
            href={`/vendors/${existingVendorSlug}`}
            className="mt-6 inline-flex items-center justify-center bg-[--color-accent] text-white rounded-md px-4 py-2 text-sm font-medium"
          >
            View my listing
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8 pb-32">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold">List your vendor booth</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Tell customers who you are and where to find you. Takes about 90 seconds.
        </p>

        <form onSubmit={handleSubmit} data-testid="vendor-registration-form" className="mt-6 space-y-5">
          {/* Identity */}
          <Field label="Vendor name" error={errors.name}>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Honeybee Hollow"
              className="input"
            />
          </Field>

          <Field label="Tagline (one sentence)" error={errors.tagline} hint={`${tagline.length}/120`}>
            <input
              type="text"
              required
              maxLength={120}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Raw wildflower honey from the Sierra foothills"
              className="input"
            />
          </Field>

          {/* Categories */}
          <Field label="What do you sell?" error={errors.categories} hint="Pick one or more">
            <div className="grid grid-cols-4 gap-2">
              {CATEGORY_ORDER.map((slug) => {
                const meta = CATEGORIES[slug]
                const on = selectedCategories.includes(slug)
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => toggleCategory(slug)}
                    data-selected={on}
                    className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 p-2 border transition ${
                      on ? 'bg-[--color-accent-tint] border-[--color-accent]' : 'bg-neutral-50 border-neutral-200'
                    }`}
                  >
                    <span className="text-2xl">{meta.emoji}</span>
                    <span className="text-[10px] font-medium text-neutral-700 text-center leading-tight">
                      {meta.label}
                    </span>
                  </button>
                )
              })}
            </div>
            {selectedCategories.length > 1 && (
              <div className="mt-3 text-xs">
                <span className="text-neutral-600">Primary category:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selectedCategories.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => setPrimaryCategory(slug)}
                      className={`rounded-full px-2 py-0.5 ${
                        primaryCategory === slug ? 'bg-[--color-accent] text-white' : 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      {CATEGORIES[slug].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          {/* Markets */}
          <Field label="Which markets do you sell at?" error={errors.markets} hint="Check all that apply">
            <div className="space-y-2">
              {availableMarkets.length === 0 && (
                <p className="text-xs text-neutral-500">Loading markets…</p>
              )}
              {availableMarkets.map((m) => {
                const on = selectedMarketIds.includes(m.id)
                return (
                  <label
                    key={m.id}
                    data-selected={on}
                    className={`block cursor-pointer rounded-lg border p-3 transition ${
                      on ? 'bg-[--color-accent-tint] border-[--color-accent]' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleMarket(m.id)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <div>
                        <p className="font-medium text-sm text-neutral-900">{m.name}</p>
                        <p className="text-xs text-neutral-600">
                          {m.city}, {m.state} · {m.schedule_days.join(', ')}{' '}
                          {m.schedule_start_time && m.schedule_end_time && (
                            <>
                              · {m.schedule_start_time}–{m.schedule_end_time}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </Field>

          {/* Address */}
          <div>
            <p className="text-sm font-medium text-neutral-900">Where is your vendor based?</p>
            <p className="text-xs text-neutral-500 mt-1">
              Your home, farm, or studio address — used to pin your listing on the map.
            </p>
            <div className="mt-3 space-y-3">
              <Field label="Street" error={errors.street} inline>
                <input
                  type="text"
                  required
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="input"
                />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="City" error={errors.city} inline>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="State" error={errors.state} inline>
                  <input
                    type="text"
                    required
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="ZIP" error={errors.zip} inline>
                  <input
                    type="text"
                    required
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    className="input"
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* Story */}
          <Field label="Your story (optional)">
            <textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              rows={4}
              placeholder="Tell customers who you are, how you got started, what makes your product special…"
              className="input"
            />
          </Field>

          {/* Cover */}
          <Field
            label="Cover photo URL (optional)"
            hint="Paste a link to an image of your product or booth. Upload is coming soon."
          >
            <input
              type="url"
              value={coverPhotoUrl}
              onChange={(e) => setCoverPhotoUrl(e.target.value)}
              placeholder="https://…"
              className="input"
            />
          </Field>

          {/* Links */}
          <Field label="Website (optional)">
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourshop.com"
              className="input"
            />
          </Field>
          <Field label="Instagram handle (optional)">
            <input
              type="text"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="@yourhandle"
              className="input"
            />
          </Field>
          <Field label="Contact email (optional)">
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
            />
          </Field>

          {formError && (
            <p data-testid="form-error" className="text-sm text-red-600">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="submit-registration"
            className="w-full rounded-full bg-[--color-accent] text-white py-3 font-medium disabled:opacity-50"
          >
            {submitting ? 'Publishing…' : 'Publish my listing'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  hint,
  children,
  inline,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
  inline?: boolean
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className={`${inline ? 'text-xs' : 'text-sm'} font-medium text-neutral-900`}>{label}</span>
        {hint && <span className="text-[11px] text-neutral-500">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
