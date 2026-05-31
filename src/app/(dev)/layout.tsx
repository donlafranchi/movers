// Dev-only route group gate.
// Source: T071 M4 retroactive checklist — every page under src/app/(dev)/*
// is verification-only and must not be reachable in production.
//
// Next.js App Router treats `(dev)` as an organizational group: directories in
// parens don't affect URLs, so without this gate `src/app/(dev)/composer-demo`
// would render at `/composer-demo` on every environment. The notFound() call
// here intercepts that path before the page body runs.

import { notFound } from 'next/navigation'

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return <>{children}</>
}
