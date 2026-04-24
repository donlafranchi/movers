import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { nextMarketDate } from '@/lib/market-dates'
import type { Market, Vendor } from '@/lib/types'

export const runtime = 'nodejs'

interface PendingEmail {
  to: string
  vendorName: string
  marketName: string
  marketDate: string
  vendorSlug: string
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'missing supabase env' }, { status: 500 })

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const [{ data: vendors }, { data: markets }, { data: links }, { data: follows }, { data: prefs }, { data: notified }] = await Promise.all([
    admin.from('businesses').select('*'),
    admin.from('markets').select('*'),
    admin.from('market_vendors').select('vendor_id, market_id'),
    admin.from('follows').select('user_id, vendor_id'),
    admin.from('user_preferences').select('user_id, follow_emails_enabled'),
    admin.from('follow_notifications').select('user_id, vendor_id, market_id, market_date'),
  ])

  const vendorMap = new Map<string, Vendor>((vendors ?? []).map((v: Vendor) => [v.id, v]))
  const marketMap = new Map<string, Market>((markets ?? []).map((m: Market) => [m.id, m]))
  const optOuts = new Set(
    (prefs ?? []).filter((p: { follow_emails_enabled: boolean }) => !p.follow_emails_enabled).map((p: { user_id: string }) => p.user_id)
  )
  const sentKey = (a: { user_id: string; vendor_id: string; market_id: string; market_date: string }) =>
    `${a.user_id}|${a.vendor_id}|${a.market_id}|${a.market_date}`
  const sentSet = new Set((notified ?? []).map(sentKey))

  const today = new Date()
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + 3)

  const linkMap = new Map<string, string[]>()
  for (const l of links ?? []) {
    const arr = linkMap.get(l.vendor_id) ?? []
    arr.push(l.market_id)
    linkMap.set(l.vendor_id, arr)
  }

  const { data: userResp } = await admin.auth.admin.listUsers()
  const userEmails = new Map<string, string>()
  for (const u of userResp.users ?? []) {
    if (u.email) userEmails.set(u.id, u.email)
  }

  const pending: PendingEmail[] = []
  const insertRows: { user_id: string; vendor_id: string; market_id: string; market_date: string }[] = []

  for (const f of follows ?? []) {
    if (optOuts.has(f.user_id)) continue
    const email = userEmails.get(f.user_id)
    if (!email) continue
    const vendor = vendorMap.get(f.vendor_id)
    if (!vendor) continue
    const marketIds = linkMap.get(f.vendor_id) ?? []
    for (const mid of marketIds) {
      const m = marketMap.get(mid)
      if (!m) continue
      const next = nextMarketDate(m.schedule_days, today)
      if (!next || next > horizon) continue
      const dateStr = next.toISOString().slice(0, 10)
      const key = sentKey({ user_id: f.user_id, vendor_id: f.vendor_id, market_id: mid, market_date: dateStr })
      if (sentSet.has(key)) continue
      pending.push({
        to: email,
        vendorName: vendor.name,
        marketName: m.name,
        marketDate: next.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        vendorSlug: vendor.slug,
      })
      insertRows.push({ user_id: f.user_id, vendor_id: f.vendor_id, market_id: mid, market_date: dateStr })
    }
  }

  // Send via Resend if configured. Otherwise log — local dev path.
  const resendKey = process.env.RESEND_API_KEY
  let sent = 0
  for (const p of pending) {
    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.FOLLOW_EMAIL_FROM ?? 'Main Street <noreply@mainstreetmarket.com>',
          to: p.to,
          subject: `${p.vendorName} will be at ${p.marketName} on ${p.marketDate}`,
          html: `<p>${p.vendorName} is at <strong>${p.marketName}</strong> on ${p.marketDate}.</p><p><a href="https://mainstreetmarket.com/vendors/${p.vendorSlug}">View vendor profile</a></p>`,
        }),
      })
      if (res.ok) sent++
    } else {
      console.log('[follow-notify dry-run]', p)
      sent++
    }
  }

  if (insertRows.length > 0) {
    await admin.from('follow_notifications').insert(insertRows)
  }

  return NextResponse.json({ pending: pending.length, sent, dryRun: !resendKey })
}
