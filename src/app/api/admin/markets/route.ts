import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const body = await req.json()
  const payload = {
    name: String(body.name ?? '').trim(),
    slug: String(body.slug ?? '').trim().toLowerCase(),
    city: String(body.city ?? '').trim(),
    state: String(body.state ?? '').trim(),
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    schedule_days: Array.isArray(body.schedule_days) ? body.schedule_days : [],
    schedule_start_time: body.schedule_start_time || null,
    schedule_end_time: body.schedule_end_time || null,
    description: body.description || null,
  }
  if (!payload.name || !payload.slug || !payload.city || !payload.state || Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
    return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
  }
  if (body.id) {
    const { data, error } = await guard.admin.from('markets').update(payload).eq('id', body.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ market: data })
  }
  const { data, error } = await guard.admin.from('markets').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ market: data })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const { error } = await guard.admin.from('markets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
