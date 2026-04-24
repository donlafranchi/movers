'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Market } from '@/lib/types'

interface Ctx {
  selectedMarket: Market | null
  setSelectedMarket: (m: Market | null) => void
  allMarkets: Market[]
  loaded: boolean
}

const MarketCtx = createContext<Ctx>({
  selectedMarket: null,
  setSelectedMarket: () => {},
  allMarkets: [],
  loaded: false,
})

const LS_KEY = 'msm.selectedMarketId'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [selectedMarket, setSelected] = useState<Market | null>(null)
  const [allMarkets, setAllMarkets] = useState<Market[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const client = supabase()
    client
      .from('markets')
      .select('*')
      .order('name')
      .then(({ data }) => {
        const markets = (data ?? []) as Market[]
        setAllMarkets(markets)

        let marketId: string | null = null
        try {
          marketId = localStorage.getItem(LS_KEY)
        } catch {}

        client.auth.getUser().then(async ({ data: userData }) => {
          const uid = userData.user?.id
          if (uid) {
            const { data: prefs } = await client
              .from('user_preferences')
              .select('selected_market_id')
              .eq('user_id', uid)
              .maybeSingle()
            if (prefs?.selected_market_id) marketId = prefs.selected_market_id as string
          }
          if (marketId) {
            const match = markets.find((m) => m.id === marketId) ?? null
            setSelected(match)
          }
          setLoaded(true)
        })
      })
  }, [])

  const setSelectedMarket = useCallback((m: Market | null) => {
    setSelected(m)
    try {
      if (m) localStorage.setItem(LS_KEY, m.id)
      else localStorage.removeItem(LS_KEY)
    } catch {}
    const client = supabase()
    client.auth.getUser().then(({ data }) => {
      const uid = data.user?.id
      if (!uid) return
      client
        .from('user_preferences')
        .upsert({ user_id: uid, selected_market_id: m?.id ?? null, updated_at: new Date().toISOString() })
        .then(() => {})
    })
  }, [])

  return (
    <MarketCtx.Provider value={{ selectedMarket, setSelectedMarket, allMarkets, loaded }}>
      {children}
    </MarketCtx.Provider>
  )
}

export function useMarket() {
  return useContext(MarketCtx)
}
