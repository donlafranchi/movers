'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export function useSupportCount(businessId: string | null) {
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!businessId) return

    setLoading(true)
    const supabase = createClient()

    supabase
      .from('supports')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .then(({ count: c }) => {
        setCount(c ?? 0)
        setLoading(false)
      })
  }, [businessId])

  return { count, loading }
}
