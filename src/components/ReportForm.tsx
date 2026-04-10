'use client'

import { useState, useCallback } from 'react'
import { PillarSelector } from './PillarSelector'
import { createClient } from '@/lib/supabase'
import type { ReportPillar } from '@/lib/types'

const MAX_DESCRIPTION = 500

interface ReportFormProps {
  businessId: string
  userId: string
  onClose: () => void
}

export function ReportForm({ businessId, userId, onClose }: ReportFormProps) {
  const [pillar, setPillar] = useState<ReportPillar | null>(null)
  const [description, setDescription] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [personalWitness, setPersonalWitness] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<{ pillar?: string; description?: string }>({})

  const handleDescriptionChange = useCallback((value: string) => {
    if (value.length <= MAX_DESCRIPTION) {
      setDescription(value)
    }
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: { pillar?: string; description?: string } = {}
    if (!pillar) newErrors.pillar = 'Please select a category'
    if (!description.trim()) newErrors.description = 'Please describe the concern'
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    setSubmitting(true)
    const supabase = createClient()

    const { error } = await supabase.from('reports').insert({
      business_id: businessId,
      user_id: userId,
      pillar,
      description: description.trim(),
      source_url: sourceUrl.trim() || null,
      personal_witness: personalWitness,
    })

    setSubmitting(false)

    if (!error) {
      setSubmitted(true)
    }
  }, [pillar, description, sourceUrl, personalWitness, businessId, userId])

  if (submitted) {
    return (
      <div
        data-testid="report-form"
        className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center"
      >
        <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-t-2xl p-6">
          <p data-testid="report-confirmation" className="text-center text-sm py-8">
            Thank you. Your report has been submitted.
          </p>
          <button
            onClick={onClose}
            className="w-full rounded bg-foreground text-background py-2 font-medium text-sm"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="report-form"
      className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-t-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Report a Concern</h2>
          <button onClick={onClose} className="text-zinc-400 text-xl" aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PillarSelector value={pillar} onChange={setPillar} error={errors.pillar} />

          <div data-testid="report-description">
            <span className="text-sm font-medium">What happened?</span>
            <textarea
              value={description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              rows={4}
              maxLength={MAX_DESCRIPTION}
              placeholder="Describe the concern factually..."
              className="mt-1 block w-full rounded border px-3 py-2 text-sm"
            />
            <div className="flex justify-between mt-1">
              {errors.description ? (
                <p data-testid="description-error" className="text-red-600 text-xs">{errors.description}</p>
              ) : (
                <span />
              )}
              <span
                data-testid="char-counter"
                className={`text-xs ${description.length > 450 ? 'text-red-500' : 'text-zinc-400'}`}
              >
                {description.length} / {MAX_DESCRIPTION}
              </span>
            </div>
          </div>

          <div data-testid="report-source-url">
            <span className="text-sm font-medium">Source link (optional)</span>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 block w-full rounded border px-3 py-2 text-sm"
            />
          </div>

          <label data-testid="personal-witness-checkbox" className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={personalWitness}
              onChange={(e) => setPersonalWitness(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">I witnessed this personally</span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            data-testid="report-submit"
            className="w-full rounded bg-foreground text-background py-2 font-medium text-sm disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </form>
      </div>
    </div>
  )
}
