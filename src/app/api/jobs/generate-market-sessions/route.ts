import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const JOB_NAME = 'generate_market_sessions'
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000 // ~once per day

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return NextResponse.json({ error: 'missing supabase env' }, { status: 500 })

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: last } = await admin
    .from('system_runs')
    .select('last_run_at')
    .eq('job_name', JOB_NAME)
    .maybeSingle()

  if (last && Date.now() - new Date(last.last_run_at).getTime() < MIN_INTERVAL_MS) {
    return NextResponse.json({ skipped: true })
  }

  const { data: count, error } = await admin.rpc('generate_market_sessions', { window_days: 14 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin
    .from('system_runs')
    .upsert({ job_name: JOB_NAME, last_run_at: new Date().toISOString() })

  return NextResponse.json({ ran: true, inserted: count ?? 0 })
}

export const GET = POST
