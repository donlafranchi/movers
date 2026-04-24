'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, Search, Heart, User } from 'lucide-react'

const TABS = [
  { href: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  { href: '/explore', label: 'Explore', icon: Search, match: (p: string) => p.startsWith('/explore') || p === '/map' },
  { href: '/following', label: 'Following', icon: Heart, match: (p: string) => p.startsWith('/following') },
  { href: '/you', label: 'You', icon: User, match: (p: string) => p.startsWith('/you') },
]

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  const handleClick = (href: string, isActive: boolean) => (e: React.MouseEvent) => {
    if (isActive) {
      e.preventDefault()
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      router.push(href)
      e.preventDefault()
    }
  }

  return (
    <nav
      data-testid="bottom-nav"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-neutral-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex h-16 items-stretch justify-around">
        {TABS.map((t) => {
          const active = t.match(pathname ?? '/')
          const Icon = t.icon
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                onClick={handleClick(t.href, active)}
                data-active={active ? 'true' : 'false'}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 text-xs ${
                  active ? 'text-emerald-700' : 'text-neutral-500'
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.25 : 1.75} fill={active ? 'currentColor' : 'none'} />
                <span className={active ? 'font-medium' : ''}>{t.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function TopNavDesktop() {
  const pathname = usePathname()
  return (
    <nav
      data-testid="top-nav-desktop"
      className="hidden md:flex sticky top-0 z-40 w-full items-center gap-6 border-b border-neutral-200 bg-white px-6 h-14"
    >
      <Link href="/" className="font-semibold text-emerald-700">
        Main Street
      </Link>
      <div className="flex items-center gap-4 text-sm">
        {TABS.map((t) => {
          const active = t.match(pathname ?? '/')
          return (
            <Link
              key={t.href}
              href={t.href}
              className={active ? 'text-emerald-700 font-medium' : 'text-neutral-600 hover:text-neutral-900'}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
