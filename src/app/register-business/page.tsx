'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { OwnershipSelector } from '@/components/OwnershipSelector'
import { CategoryInput } from '@/components/CategoryInput'
import { geocode } from '@/lib/geocoding'
import { uniqueSlug } from '@/lib/slugify'
import { createClient } from '@/lib/supabase'
import type { OwnershipTier } from '@/lib/types'

interface FormErrors {
  name?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  category?: string
  ownership?: string
}

export default function RegisterBusinessPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [geocodingError, setGeocodingError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})

  const [name, setName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [category, setCategory] = useState('')
  const [ownership, setOwnership] = useState<OwnershipTier | null>(null)
  const [story, setStory] = useState('')
  const [certification, setCertification] = useState('')

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signup')
    }
  }, [authLoading, user, router])

  function validate(): FormErrors {
    const e: FormErrors = {}
    if (!name.trim()) e.name = 'Business name is required'
    if (!street.trim()) e.street = 'Street address is required'
    if (!city.trim()) e.city = 'City is required'
    if (!state.trim()) e.state = 'State is required'
    if (!zip.trim()) e.zip = 'ZIP code is required'
    if (!category.trim()) e.category = 'Category is required'
    if (!ownership) e.ownership = 'Please select an ownership type'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGeocodingError(null)

    const fieldErrors = validate()
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    setSubmitting(true)

    // Geocode address
    const fullAddress = `${street}, ${city}, ${state} ${zip}`
    const results = await geocode(fullAddress)

    if (results.length === 0) {
      setGeocodingError('Could not find this address. Please check and try again.')
      setSubmitting(false)
      return
    }

    const [longitude, latitude] = results[0].coordinates
    const slug = await uniqueSlug(name)
    const supabase = createClient()

    const record: Record<string, unknown> = {
      user_id: user!.id,
      name: name.trim(),
      slug,
      street_address: street.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      latitude,
      longitude,
      category: category.trim(),
      ownership_tier: ownership,
      story: story.trim() || null,
      metadata: {},
    }

    if (ownership === 'mission-driven' && certification.trim()) {
      record.certification_type = certification.trim()
    }

    const { error } = await supabase.from('businesses').insert(record)

    setSubmitting(false)

    if (error) {
      setGeocodingError(error.message)
      return
    }

    router.push(`/business/${slug}`)
  }

  if (authLoading) return null

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold mb-6">Register Your Business</h1>

        <form onSubmit={handleSubmit} data-testid="registration-form" className="space-y-4">
          <div data-testid="field-business-name">
            <span className="text-sm font-medium">Business Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2 text-sm"
            />
            {errors.name && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{errors.name}</p>}
          </div>

          <div data-testid="field-street-address">
            <span className="text-sm font-medium">Street Address</span>
            <input
              type="text"
              required
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2 text-sm"
            />
            {errors.street && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{errors.street}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div data-testid="field-city">
              <span className="text-sm font-medium">City</span>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm"
              />
              {errors.city && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{errors.city}</p>}
            </div>
            <div data-testid="field-state">
              <span className="text-sm font-medium">State</span>
              <input
                type="text"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm"
              />
              {errors.state && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{errors.state}</p>}
            </div>
            <div data-testid="field-zip">
              <span className="text-sm font-medium">ZIP</span>
              <input
                type="text"
                required
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm"
              />
              {errors.zip && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{errors.zip}</p>}
            </div>
          </div>

          <CategoryInput value={category} onChange={setCategory} error={errors.category} />

          <OwnershipSelector value={ownership} onChange={setOwnership} error={errors.ownership} />

          {ownership === 'mission-driven' && (
            <div data-testid="field-certification">
              <span className="text-sm font-medium">Certification / Mission</span>
              <input
                type="text"
                value={certification}
                onChange={(e) => setCertification(e.target.value)}
                placeholder="e.g. Certified B Corp, Public Benefit Corporation"
                className="mt-1 block w-full rounded border px-3 py-2 text-sm"
              />
            </div>
          )}

          <div data-testid="field-story">
            <span className="text-sm font-medium">Your Story (optional)</span>
            <textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              rows={4}
              placeholder="Tell your community what makes your business special..."
              className="mt-1 block w-full rounded border px-3 py-2 text-sm"
            />
          </div>

          {geocodingError && (
            <p data-testid="geocoding-error" className="text-red-600 text-sm">
              {geocodingError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="submit-registration"
            className="w-full rounded bg-foreground text-background py-3 font-medium disabled:opacity-50"
          >
            {submitting ? 'Registering...' : 'Register Business'}
          </button>
        </form>
      </div>
    </div>
  )
}
