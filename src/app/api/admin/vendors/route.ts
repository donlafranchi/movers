import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const update: Record<string, unknown> = {}
  const allow = [
    'name', 'slug', 'street_address', 'city', 'state', 'zip',
    'latitude', 'longitude', 'category', 'ownership_tier',
    'story', 'tagline', 'cover_photo_url', 'website_url',
    'instagram_handle', 'contact_email', 'is_featured',
  ]
  for (const k of allow) {
    if (k in body) update[k] = body[k] === '' ? null : body[k]
  }
  if (typeof update.latitude === 'string') update.latitude = Number(update.latitude) || null
  if (typeof update.longitude === 'string') update.longitude = Number(update.longitude) || null

  const { data: vendor, error } = await guard.admin
    .from('businesses')
    .update(update)
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (Array.isArray(body.market_ids)) {
    await guard.admin.from('market_vendors').delete().eq('vendor_id', body.id)
    if (body.market_ids.length > 0) {
      const rows = body.market_ids.map((mid: string) => ({ market_id: mid, vendor_id: body.id }))
      await guard.admin.from('market_vendors').insert(rows)
    }
  }
  if (Array.isArray(body.category_slugs)) {
    await guard.admin.from('vendor_categories').delete().eq('vendor_id', body.id)
    if (body.category_slugs.length > 0) {
      const primary = body.primary_category ?? body.category_slugs[0]
      const rows = body.category_slugs.map((slug: string) => ({
        vendor_id: body.id,
        category_slug: slug,
        is_primary: slug === primary,
      }))
      await guard.admin.from('vendor_categories').insert(rows)
    }
  }
  return NextResponse.json({ vendor })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const { error } = await guard.admin.from('businesses').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
