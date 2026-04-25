import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const RATE_LIMIT_COUNT = 3
const RATE_LIMIT_WINDOW_MS = 7 * 24 * 3600 * 1000

interface Body {
  vendor_id: string
  title?: string | null
  body: string
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return NextResponse.json({ error: 'missing supabase env' }, { status: 500 })

  // Identify caller via auth cookie
  const cookieStore = await cookies()
  const authClient = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {},
    },
  })
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const payload = (await request.json()) as Body
  if (!payload.vendor_id || !payload.body?.trim()) {
    return NextResponse.json({ error: 'vendor_id and body required' }, { status: 400 })
  }

  const admin = createClient(url, key, { auth: { persistSession: false } })

  // Verify ownership
  const { data: vendor } = await admin
    .from('businesses')
    .select('id, user_id, name')
    .eq('id', payload.vendor_id)
    .maybeSingle()
  if (!vendor || vendor.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Rate limit
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count: recentCount } = await admin
    .from('vendor_bulletins')
    .select('id', { count: 'exact', head: true })
    .eq('vendor_id', payload.vendor_id)
    .not('published_at', 'is', null)
    .gte('published_at', since)
  if ((recentCount ?? 0) >= RATE_LIMIT_COUNT) {
    return NextResponse.json(
      { error: 'rate_limited', message: `You've sent ${RATE_LIMIT_COUNT} bulletins this week. Please wait before sending more — followers are more engaged when bulletins are rare.` },
      { status: 429 }
    )
  }

  // Insert bulletin
  const { data: bulletin, error: insertErr } = await admin
    .from('vendor_bulletins')
    .insert({
      vendor_id: payload.vendor_id,
      author_user_id: user.id,
      title: payload.title?.trim() || null,
      body: payload.body.trim(),
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (insertErr || !bulletin) {
    return NextResponse.json({ error: insertErr?.message ?? 'insert failed' }, { status: 500 })
  }

  // Fan out to active followers
  const { data: follows } = await admin
    .from('follows')
    .select('user_id')
    .eq('vendor_id', payload.vendor_id)
    .is('unfollowed_at', null)
  const followerIds = Array.from(new Set((follows ?? []).map((f) => f.user_id)))

  if (followerIds.length > 0) {
    const rows = followerIds.map((uid) => ({ bulletin_id: bulletin.id, user_id: uid }))
    await admin.from('bulletin_deliveries').insert(rows)
    // TODO: enqueue email send (Resend) for users with notif_email_bulletins=true
    // and bulletin_deliveries.unsubscribed_at IS NULL
  }

  // Analytics
  await admin.from('vendor_events').insert({
    vendor_id: payload.vendor_id,
    user_id: user.id,
    event_name: 'bulletin_published',
    metadata: { bulletin_id: bulletin.id, recipient_count: followerIds.length },
  })

  return NextResponse.json({ id: bulletin.id, recipients: followerIds.length })
}
