import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

function csvEscape(v: string | null | undefined): string {
  if (v == null) return ''
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return NextResponse.json({ error: 'missing supabase env' }, { status: 500 })

  const cookieStore = await cookies()
  const authClient = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  })
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: vendor } = await admin
    .from('businesses')
    .select('id, slug')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (!vendor) return NextResponse.json({ error: 'no vendor' }, { status: 404 })

  const { data: follows } = await admin
    .from('follows')
    .select('user_id, created_at')
    .eq('vendor_id', vendor.id)
    .is('unfollowed_at', null)
    .order('created_at', { ascending: false })

  const userIds = Array.from(new Set((follows ?? []).map((f) => f.user_id)))
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const userMap = new Map<string, { email: string | undefined }>()
  for (const u of users?.users ?? []) {
    if (userIds.includes(u.id)) userMap.set(u.id, { email: u.email })
  }

  const lines: string[] = ['display_name,city,followed_at']
  for (const f of follows ?? []) {
    const u = userMap.get(f.user_id)
    const display = u?.email?.split('@')[0] ?? 'Anonymous'
    lines.push([csvEscape(display), csvEscape(''), csvEscape(f.created_at)].join(','))
  }

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${vendor.slug}-followers.csv"`,
    },
  })
}
