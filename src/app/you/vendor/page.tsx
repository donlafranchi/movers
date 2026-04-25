import Link from 'next/link'

export default function VendorModePage() {
  return (
    <main className="pb-24 max-w-3xl mx-auto p-6" data-testid="vendor-mode-page">
      <Link href="/you" className="text-sm text-[--color-accent] hover:underline">
        ← Back to You
      </Link>
      <h1 className="text-2xl font-semibold mt-3">Vendor Mode</h1>
      <p className="text-sm text-neutral-600 mt-2">
        Your vendor dashboard. From here you'll see follower counts, send bulletins, and manage your listing.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Link
          href="/you/vendor/bulletins"
          data-testid="vendor-bulletins-link"
          className="card card-hover p-4 hover:no-underline"
        >
          <h2 className="font-semibold text-neutral-900">Bulletins</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Broadcast to all your active followers. They'll see it in their feed and inbox.
          </p>
        </Link>
        <div className="card p-4 opacity-60">
          <h2 className="font-semibold text-neutral-900">Dashboard</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Followers, profile views, and engagement — coming soon (T026).
          </p>
        </div>
      </div>
    </main>
  )
}
