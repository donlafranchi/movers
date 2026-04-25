'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Vendor, VendorAnalyticsEvent, VendorStatsDaily, Follow } from '@/lib/types'
import { Sparkline } from '@/components/Sparkline'

type Tab = 'overview' | 'followers' | 'activity'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

interface DashboardData {
  vendor: Vendor
  follows: Follow[]
  stats14: VendorStatsDaily[]
  events7: VendorAnalyticsEvent[]
  events14: VendorAnalyticsEvent[]
  hasMarkets: boolean
  hasBulletin30d: boolean
}

export default function VendorDashboardPage() {
  return (
    <Suspense fallback={<main className="p-4 pb-24">Loading…</main>}>
      <VendorDashboardInner />
    </Suspense>
  )
}

function VendorDashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = (searchParams.get('tab') as Tab) || 'overview'
  const tab: Tab = ['overview', 'followers', 'activity'].includes(tabParam) ? tabParam : 'overview'

  const [data, setData] = useState<DashboardData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data: u }) => {
      if (!u.user) {
        router.replace('/auth/login?next=/you/vendor')
        return
      }
      const { data: vendor } = await client
        .from('businesses')
        .select('*')
        .eq('user_id', u.user.id)
        .limit(1)
        .maybeSingle()
      if (!vendor) {
        router.replace('/join')
        return
      }
      const v = vendor as Vendor
      const since14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
      const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

      const [
        { data: follows },
        { data: stats14 },
        { data: events14 },
        { data: events7 },
        { data: markets },
        { data: bulletins },
      ] = await Promise.all([
        client.from('follows').select('*').eq('vendor_id', v.id).is('unfollowed_at', null).order('created_at', { ascending: false }),
        client.from('vendor_stats_daily').select('*').eq('vendor_id', v.id).gte('day', since14.slice(0, 10)).order('day'),
        client.from('vendor_events').select('*').eq('vendor_id', v.id).gte('created_at', since14),
        client.from('vendor_events').select('*').eq('vendor_id', v.id).gte('created_at', since7),
        client.from('market_vendors').select('market_id').eq('vendor_id', v.id),
        client.from('vendor_bulletins').select('id').eq('vendor_id', v.id).not('published_at', 'is', null).gte('published_at', since30),
      ])

      setData({
        vendor: v,
        follows: (follows ?? []) as Follow[],
        stats14: (stats14 ?? []) as VendorStatsDaily[],
        events14: (events14 ?? []) as VendorAnalyticsEvent[],
        events7: (events7 ?? []) as VendorAnalyticsEvent[],
        hasMarkets: (markets ?? []).length > 0,
        hasBulletin30d: (bulletins ?? []).length > 0,
      })
      setLoaded(true)
    })
  }, [router])

  const setTab = (next: Tab) => router.replace(`/you/vendor?tab=${next}`, { scroll: false })

  if (!loaded || !data) return <main className="p-4 pb-24">Loading…</main>

  return (
    <main className="pb-24 max-w-4xl mx-auto p-4" data-testid="vendor-dashboard">
      <Link href="/you" className="text-sm text-[--color-accent] hover:underline">← Back to You</Link>
      <header className="mt-3 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{data.vendor.name}</h1>
          <p className="text-sm text-neutral-600 mt-0.5">Vendor mode</p>
        </div>
        <Link href="/you/vendor/bulletins" className="text-sm font-medium text-[--color-accent] hover:underline">
          Bulletins →
        </Link>
      </header>

      <nav className="mt-6 flex gap-2" role="tablist">
        {(['overview', 'followers', 'activity'] as Tab[]).map((t) => {
          const active = tab === t
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`vendor-tab-${t}`}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
                active ? 'bg-[--color-accent] text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {t}
            </button>
          )
        })}
      </nav>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          {tab === 'overview' && <OverviewTab data={data} />}
          {tab === 'followers' && <FollowersTab data={data} />}
          {tab === 'activity' && <ActivityTab data={data} />}
        </div>
        <div className="md:col-span-1">
          <TopTasks data={data} />
        </div>
      </div>
    </main>
  )
}

// ---------- Overview ----------

function OverviewTab({ data }: { data: DashboardData }) {
  const followerCount = data.follows.length
  const recent7Follows = data.follows.filter(
    (f) => Date.parse(f.created_at) >= Date.now() - 7 * 24 * 3600 * 1000
  ).length

  const count7 = (name: string, sourceWindow: VendorAnalyticsEvent[]) =>
    sourceWindow.filter((e) => e.event_name === name).length
  const prevWindow = data.events14.filter(
    (e) =>
      Date.parse(e.created_at) < Date.now() - 7 * 24 * 3600 * 1000 &&
      Date.parse(e.created_at) >= Date.now() - 14 * 24 * 3600 * 1000
  )

  const profileViews7 = count7('profile_view', data.events7)
  const profileViewsPrev = count7('profile_view', prevWindow)
  const supportClicks7 = count7('support_click', data.events7)
  const supportClicksPrev = count7('support_click', prevWindow)
  const bulletinOpens7 = data.stats14
    .filter((s) => Date.parse(s.day) >= Date.now() - 7 * 24 * 3600 * 1000)
    .reduce((sum, s) => sum + (s.bulletin_opens ?? 0), 0)
  const bulletinOpensPrev = data.stats14
    .filter(
      (s) =>
        Date.parse(s.day) < Date.now() - 7 * 24 * 3600 * 1000 &&
        Date.parse(s.day) >= Date.now() - 14 * 24 * 3600 * 1000
    )
    .reduce((sum, s) => sum + (s.bulletin_opens ?? 0), 0)

  const sparkData = (selector: (s: VendorStatsDaily) => number) => {
    const days: number[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const iso = d.toISOString().slice(0, 10)
      const row = data.stats14.find((s) => s.day === iso)
      days.push(row ? selector(row) : 0)
    }
    return days
  }

  return (
    <section data-testid="overview-tab" className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Followers"
          value={followerCount}
          delta={recent7Follows}
          deltaLabel={`+${recent7Follows} this week`}
          spark={sparkData((s) => s.new_follows)}
        />
        <MetricCard
          label="Profile views (7d)"
          value={profileViews7}
          delta={profileViews7 - profileViewsPrev}
          deltaLabel={fmtDelta(profileViews7, profileViewsPrev)}
          spark={sparkData((s) => s.profile_views)}
        />
        <MetricCard
          label="Support clicks (7d)"
          value={supportClicks7}
          delta={supportClicks7 - supportClicksPrev}
          deltaLabel={fmtDelta(supportClicks7, supportClicksPrev)}
          spark={sparkData((s) => s.support_clicks)}
        />
        <MetricCard
          label="Bulletin opens (7d)"
          value={bulletinOpens7}
          delta={bulletinOpens7 - bulletinOpensPrev}
          deltaLabel={fmtDelta(bulletinOpens7, bulletinOpensPrev)}
          spark={sparkData((s) => s.bulletin_opens ?? 0)}
        />
      </div>

      <ListingHealth data={data} />
    </section>
  )
}

function MetricCard({
  label,
  value,
  delta,
  deltaLabel,
  spark,
}: {
  label: string
  value: number
  delta: number
  deltaLabel: string
  spark: number[]
}) {
  const positive = delta >= 0
  return (
    <div className="card p-4" data-testid="metric-card">
      <p className="text-xs uppercase tracking-wide text-neutral-500 font-semibold">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold text-neutral-900">{value}</p>
        <Sparkline values={spark} className={positive ? 'text-[--color-accent]' : 'text-neutral-400'} />
      </div>
      <p className={`text-xs mt-1 ${positive ? 'text-[--color-accent]' : 'text-neutral-500'}`}>
        {deltaLabel}
      </p>
    </div>
  )
}

function fmtDelta(curr: number, prev: number): string {
  const diff = curr - prev
  if (prev === 0 && curr === 0) return 'No activity yet'
  if (prev === 0) return `+${curr} from 0`
  const pct = Math.round((diff / prev) * 100)
  return `${diff >= 0 ? '+' : ''}${diff} (${pct >= 0 ? '+' : ''}${pct}%) vs prior 7d`
}

// ---------- Listing Health ----------

interface HealthCheck {
  key: string
  label: string
  done: boolean
  fixHref?: string
}

function computeHealth(data: DashboardData): { score: number; checks: HealthCheck[]; suggestion: HealthCheck | null } {
  const v = data.vendor
  const checks: HealthCheck[] = [
    { key: 'cover_photo', label: 'Cover photo', done: !!v.cover_photo_url, fixHref: '/register-vendor' },
    { key: 'story', label: 'Story (200+ chars)', done: !!v.story && v.story.length >= 200, fixHref: '/register-vendor' },
    { key: 'tagline', label: 'Tagline', done: !!v.tagline, fixHref: '/register-vendor' },
    { key: 'markets', label: 'Listed at a market', done: data.hasMarkets, fixHref: '/register-vendor' },
    { key: 'bulletin', label: 'Sent a bulletin in last 30 days', done: data.hasBulletin30d, fixHref: '/you/vendor/bulletins/new' },
  ]
  const done = checks.filter((c) => c.done).length
  const score = Math.round((done / checks.length) * 100)
  const suggestion = checks.find((c) => !c.done) ?? null
  return { score, checks, suggestion }
}

function ListingHealth({ data }: { data: DashboardData }) {
  const { score, checks, suggestion } = useMemo(() => computeHealth(data), [data])
  return (
    <div className="card p-4" data-testid="listing-health">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-neutral-900">Listing health</h2>
        <p className="text-2xl font-semibold text-[--color-accent]">{score}<span className="text-sm text-neutral-500">/100</span></p>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
        <div className="h-full bg-[--color-accent]" style={{ width: `${score}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            <span className={c.done ? 'text-[--color-accent]' : 'text-neutral-400'}>{c.done ? '✓' : '○'}</span>
            <span className={c.done ? 'text-neutral-500 line-through' : 'text-neutral-700'}>{c.label}</span>
          </li>
        ))}
      </ul>
      {suggestion && (
        <div className="mt-3 pt-3 border-t border-neutral-200">
          <p className="text-xs uppercase tracking-wide font-semibold text-neutral-500">Suggested next step</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-sm text-neutral-800">{suggestion.label}</p>
            {suggestion.fixHref && (
              <Link href={suggestion.fixHref} className="text-sm font-medium text-[--color-accent] hover:underline">
                Fix it →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Followers ----------

function FollowersTab({ data }: { data: DashboardData }) {
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const start = page * PAGE_SIZE
  const slice = data.follows.slice(start, start + PAGE_SIZE)

  // Daily growth for last 90 days
  const points: number[] = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dayEnd = d.getTime() + 24 * 3600 * 1000
    points.push(data.follows.filter((f) => Date.parse(f.created_at) <= dayEnd).length)
  }

  return (
    <section data-testid="followers-tab" className="space-y-4">
      <div className="card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-neutral-900">Total followers</h2>
          <p className="text-2xl font-semibold">{data.follows.length}</p>
        </div>
        <Sparkline values={points} width={400} height={60} className="text-[--color-accent] mt-3 w-full" />
        <p className="text-xs text-neutral-500 mt-1">Last 90 days</p>
      </div>

      <div className="card p-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">Export followers</p>
          <p className="text-xs text-neutral-500">CSV with display name, city, followed_at</p>
        </div>
        <a
          href="/api/vendor/followers/export"
          data-testid="followers-export"
          className="btn-secondary"
        >
          Export CSV
        </a>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-neutral-900 mb-2">Recent followers</h2>
        {data.follows.length === 0 ? (
          <p className="text-sm text-neutral-500">No followers yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-neutral-200">
              {slice.map((f) => (
                <li key={f.id} className="py-2 flex justify-between text-sm">
                  <span className="text-neutral-700 font-mono text-xs truncate max-w-[60%]">{f.user_id.slice(0, 8)}…</span>
                  <span className="text-neutral-500">{new Date(f.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
            {data.follows.length > PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between text-sm">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="text-[--color-accent] disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span className="text-neutral-500">
                  {start + 1}–{Math.min(start + PAGE_SIZE, data.follows.length)} of {data.follows.length}
                </span>
                <button
                  type="button"
                  disabled={start + PAGE_SIZE >= data.follows.length}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-[--color-accent] disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ---------- Activity ----------

function ActivityTab({ data }: { data: DashboardData }) {
  const now = Date.now()
  const within = (e: VendorAnalyticsEvent, hoursStart: number, hoursEnd: number) => {
    const t = Date.parse(e.created_at)
    return t >= now - hoursEnd * 3600 * 1000 && t < now - hoursStart * 3600 * 1000
  }
  const count = (name: string, hoursStart: number, hoursEnd: number) =>
    data.events14.filter((e) => e.event_name === name && within(e, hoursStart, hoursEnd)).length

  const rows = [
    { label: 'Profile views', curr: count('profile_view', 0, 168), prev: count('profile_view', 168, 336) },
    { label: 'Support clicks', curr: count('support_click', 0, 168), prev: count('support_click', 168, 336) },
    { label: 'Shares', curr: count('share', 0, 168), prev: count('share', 168, 336) },
    {
      label: 'New follows',
      curr: data.follows.filter((f) => Date.parse(f.created_at) >= now - 168 * 3600 * 1000).length,
      prev: data.follows.filter(
        (f) =>
          Date.parse(f.created_at) >= now - 336 * 3600 * 1000 &&
          Date.parse(f.created_at) < now - 168 * 3600 * 1000
      ).length,
    },
  ]

  // 14-day daily breakdown
  const days: { day: string; views: number; supports: number; follows: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const dayStart = new Date(iso).getTime()
    const dayEnd = dayStart + 24 * 3600 * 1000
    days.push({
      day: iso,
      views: data.events14.filter((e) => e.event_name === 'profile_view' && Date.parse(e.created_at) >= dayStart && Date.parse(e.created_at) < dayEnd).length,
      supports: data.events14.filter((e) => e.event_name === 'support_click' && Date.parse(e.created_at) >= dayStart && Date.parse(e.created_at) < dayEnd).length,
      follows: data.follows.filter((f) => Date.parse(f.created_at) >= dayStart && Date.parse(f.created_at) < dayEnd).length,
    })
  }

  return (
    <section data-testid="activity-tab" className="space-y-4">
      <div className="card p-4">
        <h2 className="font-semibold text-neutral-900 mb-3">This week vs last</h2>
        <ul className="divide-y divide-neutral-200">
          {rows.map((r) => {
            const diff = r.curr - r.prev
            return (
              <li key={r.label} className="py-2 flex items-center justify-between text-sm">
                <span className="text-neutral-700">{r.label}</span>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-neutral-900">{r.curr}</span>
                  <span className={`text-xs ${diff >= 0 ? 'text-[--color-accent]' : 'text-red-600'}`}>
                    {diff >= 0 ? '↑' : '↓'} {Math.abs(diff)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-neutral-900 mb-2">Last 14 days</h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500 text-left">
            <tr>
              <th className="py-1">Day</th>
              <th className="py-1 text-right">Views</th>
              <th className="py-1 text-right">Supports</th>
              <th className="py-1 text-right">Follows</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-neutral-100">
                <td className="py-1 text-neutral-600">{d.day.slice(5)}</td>
                <td className="py-1 text-right">{d.views}</td>
                <td className="py-1 text-right">{d.supports}</td>
                <td className="py-1 text-right">{d.follows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------- Top Tasks ----------

interface Task {
  key: string
  label: string
  benefit: string
  done: boolean
  href: string
}

function TopTasks({ data }: { data: DashboardData }) {
  const v = data.vendor
  const tasks: Task[] = [
    {
      key: 'cover',
      label: 'Add a cover photo',
      benefit: 'Cover photos make your card pop in the feed',
      done: !!v.cover_photo_url,
      href: '/register-vendor',
    },
    {
      key: 'story',
      label: 'Write your story (200+ chars)',
      benefit: 'Profiles with a story get 60% more follows',
      done: !!v.story && v.story.length >= 200,
      href: '/register-vendor',
    },
    {
      key: 'markets',
      label: 'List the markets you attend',
      benefit: 'You only show up in feeds where you sell',
      done: data.hasMarkets,
      href: '/register-vendor',
    },
    {
      key: 'bulletin',
      label: 'Post your first bulletin',
      benefit: 'Followers who get bulletins are 3× more likely to support',
      done: data.hasBulletin30d,
      href: '/you/vendor/bulletins/new',
    },
  ]
  const remaining = tasks.filter((t) => !t.done)

  return (
    <aside className="card p-4 sticky top-4" data-testid="top-tasks">
      <h2 className="font-semibold text-neutral-900">Top tasks</h2>
      {remaining.length === 0 ? (
        <p className="text-sm text-neutral-600 mt-2">All set up ✓ — keep posting.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {tasks.map((t) => (
            <li key={t.key} className="text-sm">
              <div className="flex items-start gap-2">
                <span className={t.done ? 'text-[--color-accent]' : 'text-neutral-400'}>{t.done ? '✓' : '○'}</span>
                <div className="flex-1 min-w-0">
                  {t.done ? (
                    <p className="text-neutral-500 line-through">{t.label}</p>
                  ) : (
                    <Link href={t.href} className="text-neutral-900 font-medium hover:text-[--color-accent]">
                      {t.label}
                    </Link>
                  )}
                  {!t.done && <p className="text-xs text-neutral-500 mt-0.5">{t.benefit}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
