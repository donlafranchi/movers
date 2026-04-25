'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import type { VendorBulletin, Vendor } from '@/lib/types'

interface Props {
  bulletin: VendorBulletin
  vendor: Vendor
  userId: string | null
  onMute: (vendorId: string) => void
}

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export function BulletinFeedCard({ bulletin, vendor, userId, onMute }: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const openedRef = useRef(false)

  useEffect(() => {
    if (!userId || !ref.current || openedRef.current) return
    const el = ref.current
    const observer = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !openedRef.current) {
            openedRef.current = true
            const client = supabase()
            await client
              .from('bulletin_deliveries')
              .update({ opened_at: new Date().toISOString() })
              .eq('bulletin_id', bulletin.id)
              .eq('user_id', userId)
              .is('opened_at', null)
            observer.disconnect()
          }
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [bulletin.id, userId])

  const mute = async () => {
    if (!userId) return
    const client = supabase()
    await client.from('bulletin_mutes').upsert({ user_id: userId, vendor_id: vendor.id })
    onMute(vendor.id)
  }

  const recordClick = async () => {
    if (!userId) return
    const client = supabase()
    await client
      .from('bulletin_deliveries')
      .update({ clicked_at: new Date().toISOString() })
      .eq('bulletin_id', bulletin.id)
      .eq('user_id', userId)
      .is('clicked_at', null)
  }

  return (
    <article ref={ref} data-testid="bulletin-feed-card" className="card card-hover p-4 relative">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/vendors/${vendor.slug}`} onClick={recordClick} className="min-w-0 flex-1 hover:no-underline">
          <p className="text-xs font-semibold text-[--color-accent]">{vendor.name}</p>
          {bulletin.title && (
            <h3 className="text-sm font-semibold text-neutral-900 mt-1">{bulletin.title}</h3>
          )}
          <p className="text-sm text-neutral-700 mt-1 line-clamp-3 whitespace-pre-wrap">{bulletin.body}</p>
        </Link>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((s) => !s)}
            aria-label="Bulletin options"
            data-testid="bulletin-menu"
            className="p-1 text-neutral-500 hover:text-neutral-800"
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-7 z-10 w-48 rounded-lg border border-neutral-200 bg-white shadow-lg py-1"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  mute()
                }}
                data-testid="bulletin-mute"
                className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                Mute {vendor.name}'s bulletins
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
