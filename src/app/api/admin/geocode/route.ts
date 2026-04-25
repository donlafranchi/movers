import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const q = req.nextUrl.searchParams.get('q')
  if (!q) return NextResponse.json({ results: [] })
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) return NextResponse.json({ error: 'missing mapbox token' }, { status: 500 })
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=5&types=address,place,poi`
  const r = await fetch(url)
  if (!r.ok) return NextResponse.json({ results: [] })
  const data = await r.json()
  const results = (data.features ?? []).map((f: { place_name: string; center: [number, number] }) => ({
    name: f.place_name,
    longitude: f.center[0],
    latitude: f.center[1],
  }))
  return NextResponse.json({ results })
}
