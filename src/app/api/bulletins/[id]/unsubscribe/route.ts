import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = new URL(request.url).searchParams.get('u')
  if (!id || !userId) {
    return NextResponse.json({ error: 'missing params' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return NextResponse.json({ error: 'missing supabase env' }, { status: 500 })

  const admin = createClient(url, key, { auth: { persistSession: false } })
  await admin
    .from('bulletin_deliveries')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('bulletin_id', id)
    .eq('user_id', userId)

  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
    <style>body{font-family:system-ui;max-width:480px;margin:80px auto;padding:24px;text-align:center}</style>
    </head><body><h1>You're unsubscribed</h1><p>You won't receive future emails from this vendor's bulletins. You can still see them in your feed.</p></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  )
}
