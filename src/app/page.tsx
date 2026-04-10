'use client'

import dynamic from 'next/dynamic'

const Map = dynamic(() => import('@/components/Map').then((m) => m.Map), {
  ssr: false,
})

export default function Home() {
  return (
    <main className="h-full">
      <Map />
    </main>
  )
}
