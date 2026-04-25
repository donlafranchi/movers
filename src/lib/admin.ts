import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export async function requireAdmin(): Promise<
  | { ok: true; email: string; admin: SupabaseClient }
  | { ok: false; status: number; error: string }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !serviceKey || !pubKey) return { ok: false, status: 500, error: 'missing supabase env' }

  const cookieStore = await cookies()
  const auth = createServerClient(url, pubKey, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  })
  const { data: { user } } = await auth.auth.getUser()
  if (!user?.email) return { ok: false, status: 401, error: 'unauthenticated' }

  const allowed = adminEmails()
  if (allowed.length === 0 || !allowed.includes(user.email.toLowerCase())) {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  return { ok: true, email: user.email, admin }
}

export async function isAdminUser(): Promise<{ admin: boolean; email: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !pubKey) return { admin: false, email: null }
  const cookieStore = await cookies()
  const auth = createServerClient(url, pubKey, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  })
  const { data: { user } } = await auth.auth.getUser()
  if (!user?.email) return { admin: false, email: null }
  const allowed = adminEmails()
  return { admin: allowed.includes(user.email.toLowerCase()), email: user.email }
}
