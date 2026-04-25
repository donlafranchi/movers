'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, Search, User } from 'lucide-react'
import { AuthCtaButtons } from './AuthCtaButtons'

const TABS = [
  { href: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  { href: '/explore', label: 'Explore', icon: Search, match: (p: string) => p.startsWith('/explore') || p === '/map', hero: true },
  { href: '/you', label: 'You', icon: User, match: (p: string) => p.startsWith('/you') || p.startsWith('/following') },
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
      <ul className="mx-auto flex h-16 w-[60%] max-w-[360px] items-stretch justify-between">
        {TABS.map((t) => {
          const active = t.match(pathname ?? '/')
          const Icon = t.icon
          if (t.hero) {
            return (
              <li key={t.href} className="flex items-center">
                <Link
                  href={t.href}
                  onClick={handleClick(t.href, active)}
                  data-active={active ? 'true' : 'false'}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-12 w-12 items-center justify-center rounded-full shadow-md transition-colors ${
                    active ? 'bg-[--color-accent] text-white' : 'bg-[--color-accent] text-white hover:bg-[--color-accent]'
                  }`}
                  aria-label={t.label}
                >
                  <Icon size={22} strokeWidth={2.25} />
                </Link>
              </li>
            )
          }
          return (
            <li key={t.href} className="flex items-center">
              <Link
                href={t.href}
                onClick={handleClick(t.href, active)}
                data-active={active ? 'true' : 'false'}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 text-[11px] ${
                  active ? 'text-[--color-accent]' : 'text-neutral-500'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} fill={active ? 'currentColor' : 'none'} />
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
      <Link href="/" className="font-semibold text-[--color-accent]">
        Main Street
      </Link>
      <div className="flex items-center gap-4 text-sm">
        {TABS.map((t) => {
          const active = t.match(pathname ?? '/')
          return (
            <Link
              key={t.href}
              href={t.href}
              className={active ? 'text-[--color-accent] font-medium' : 'text-neutral-600 hover:text-neutral-900'}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
      <div className="ml-auto">
        <AuthCtaButtons />
      </div>
    </nav>
  )
}
