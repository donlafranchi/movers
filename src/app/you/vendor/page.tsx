import Link from 'next/link'

export default function VendorModePage() {
  return (
    <main className="pb-24 max-w-3xl mx-auto p-6" data-testid="vendor-mode-page">
      <Link href="/you" className="text-sm text-[--color-accent] hover:underline">
        ← Back to You
      </Link>
      <h1 className="text-2xl font-semibold mt-3">Vendor Mode</h1>
      <p className="text-sm text-neutral-600 mt-2">
        Your vendor dashboard is coming soon. From here you'll see follower counts, send bulletins,
        and manage your listing.
      </p>
      <div className="mt-6 rounded-xl border border-dashed border-neutral-300 p-6 text-center">
        <p className="text-sm text-neutral-500">Dashboard placeholder — see ticket T026.</p>
      </div>
    </main>
  )
}
