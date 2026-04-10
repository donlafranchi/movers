export interface GeocodingResult {
  name: string
  coordinates: [number, number]
}

export async function geocode(query: string): Promise<GeocodingResult[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token || !query.trim()) return []

  const encoded = encodeURIComponent(query.trim())
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=5&types=place,locality,neighborhood,address`
  )

  if (!res.ok) return []

  const data = await res.json()
  return (data.features || []).map((f: { place_name: string; center: [number, number] }) => ({
    name: f.place_name,
    coordinates: f.center,
  }))
}
