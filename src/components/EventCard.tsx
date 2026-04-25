'use client'

import { useRouter } from 'next/navigation'
import { Calendar, Sparkles, Store } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import type { PlatformEvent, Vendor, Market } from '@/lib/types'

interface Props {
  event: PlatformEvent
  hostName: string
  hostSlug: string
  hostType: 'vendor' | 'market'
  hostCoverPhotoUrl?: string | null
}

const EVENT_LABEL: Record<string, string> = {
  market_session: 'Market',
  vendor_special: 'Vendor Special',
  class: 'Class',
  community_project: 'Community',
}

const EVENT_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  market_session: Store,
  vendor_special: Sparkles,
  class: Calendar,
  community_project: Calendar,
}

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

function formatStartsAt(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay(d, today)) return `Today · ${time}`
  if (sameDay(d, tomorrow)) return `Tomorrow · ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`
}

export function EventCard({ event, hostName, hostSlug, hostType, hostCoverPhotoUrl }: Props) {
  const router = useRouter()
  const Icon = EVENT_ICON[event.event_type] ?? Calendar
  const cover = event.cover_photo_url ?? hostCoverPhotoUrl ?? null

  const onClick = async () => {
    const target = hostType === 'vendor' ? `/vendors/${hostSlug}` : `/explore?market=${hostSlug}`
    if (hostType === 'vendor') {
      try {
        const client = supabase()
        const { data } = await client.auth.getUser()
        await client.from('vendor_events').insert({
          vendor_id: event.host_id,
          user_id: data.user?.id ?? null,
          event_name: 'profile_view',
          referrer: 'home_feed',
          metadata: { event_id: event.id, event_type: event.event_type },
        })
      } catch {
        // analytics best-effort
      }
    }
    router.push(target)
  }

  return (
    <article
      data-testid="event-card"
      data-event-type={event.event_type}
      onClick={onClick}
      className="cursor-pointer card card-hover overflow-hidden"
    >
      <div className="h-32 bg-gradient-to-br from-[--color-accent-tint] to-amber-100 relative">
        {cover && <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-medium text-neutral-800">
          <Icon size={12} className="text-[--color-accent]" /> {EVENT_LABEL[event.event_type] ?? event.event_type}
        </span>
      </div>
      <div className="p-3">
        <p className="text-xs text-[--color-accent] font-semibold">{formatStartsAt(event.starts_at)}</p>
        <h3 className="text-sm font-semibold text-neutral-900 mt-0.5 line-clamp-2">{event.title}</h3>
        <p className="text-xs text-neutral-600 mt-1 truncate">{hostName}</p>
        {event.location_label && (
          <p className="text-xs text-neutral-500 mt-0.5 truncate">{event.location_label}</p>
        )}
      </div>
    </article>
  )
}

export type EventCardHostMap = Map<string, { name: string; slug: string; coverPhotoUrl: string | null }>

export function buildHostMaps(vendors: Vendor[], markets: Market[]) {
  const vendorMap: EventCardHostMap = new Map(
    vendors.map((v) => [v.id, { name: v.name, slug: v.slug, coverPhotoUrl: v.cover_photo_url ?? null }])
  )
  const marketMap: EventCardHostMap = new Map(
    markets.map((m) => [m.id, { name: m.name, slug: m.slug, coverPhotoUrl: null }])
  )
  return { vendorMap, marketMap }
}
