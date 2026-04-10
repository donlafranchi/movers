'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

const DEBOUNCE_MS = 500

export function useSupport(businessId: string, userId: string | null) {
  const [supported, setSupported] = useState(false)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = createClient()

  // Fetch initial state
  useEffect(() => {
    if (!businessId) return

    async function load() {
      setLoading(true)

      const { count: total } = await supabase
        .from('supports')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)

      setCount(total ?? 0)

      if (userId) {
        const { data } = await supabase
          .from('supports')
          .select('id')
          .eq('business_id', businessId)
          .eq('user_id', userId)
          .maybeSingle()

        setSupported(!!data)
      }

      setLoading(false)
    }

    load()
  }, [businessId, userId])

  const toggle = useCallback(() => {
    if (!userId) return

    // Optimistic update
    const newSupported = !supported
    setSupported(newSupported)
    setCount((c) => (newSupported ? c + 1 : c - 1))

    // Debounce persistence
    if (pendingRef.current) clearTimeout(pendingRef.current)

    pendingRef.current = setTimeout(async () => {
      if (newSupported) {
        const { error } = await supabase
          .from('supports')
          .upsert({ user_id: userId, business_id: businessId }, { onConflict: 'user_id,business_id' })

        if (error) {
          setSupported(!newSupported)
          setCount((c) => (newSupported ? c - 1 : c + 1))
        }
      } else {
        const { error } = await supabase
          .from('supports')
          .delete()
          .eq('user_id', userId)
          .eq('business_id', businessId)

        if (error) {
          setSupported(!newSupported)
          setCount((c) => (newSupported ? c - 1 : c + 1))
        }
      }
    }, DEBOUNCE_MS)
  }, [supported, userId, businessId])

  return { supported, count, loading, toggle }
}
