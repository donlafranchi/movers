import { Suspense } from 'react'
import { ExplorePage } from '@/components/ExplorePage'

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Loading…</div>}>
      <ExplorePage />
    </Suspense>
  )
}
