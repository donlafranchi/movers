import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminUser } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { admin, email } = await isAdminUser()
  if (!email) redirect('/auth/login?next=/admin')
  if (!admin) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your account ({email}) is not in <code>ADMIN_EMAILS</code>. Add it to the env var to access admin tools.
        </p>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-center gap-4 border-b border-neutral-200 pb-3">
        <Link href="/admin" className="font-semibold text-[var(--color-accent)]">Admin</Link>
        <Link href="/admin/markets" className="text-sm text-neutral-600 hover:text-neutral-900">Markets</Link>
        <Link href="/admin/vendors" className="text-sm text-neutral-600 hover:text-neutral-900">Vendors</Link>
        <span className="ml-auto text-xs text-neutral-500">{email}</span>
      </header>
      {children}
    </div>
  )
}
