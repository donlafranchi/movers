// T051 — Rule 3 — RLS on every public table.
// Source ticket: development/tickets/T051-action-layer-ci-enforcement.md
//
// Belt-and-suspenders. Even if Rules 1, 2, 4 are bypassed, RLS at the
// database is the last line. Queries `pg_tables` for public tables
// without `rowsecurity = true`. Allowance list is empty at Phase 0 —
// every public table must opt in to RLS.
//
// Runs only when DATABASE_URL is set (the same env var _lib/db.ts reads).
// In CI the Postgres service is up; locally the user runs `supabase start`.

import { describe, it, expect } from 'vitest'
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL

// Tables that may legitimately have RLS disabled. None at Phase 0.
const ALLOWLIST: readonly string[] = []

describe.skipIf(!DATABASE_URL)('T051 Rule 3 — RLS coverage on public schema', () => {
  it('every public table has rowsecurity = true', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL })
    try {
      const { rows } = await pool.query<{ tablename: string }>(
        `select tablename
           from pg_tables
          where schemaname = 'public'
            and rowsecurity = false
          order by tablename`,
      )
      const missing = rows
        .map((r) => r.tablename)
        .filter((t) => !ALLOWLIST.includes(t))
      expect(missing, `Tables without RLS enabled: ${missing.join(', ')}`).toEqual([])
    } finally {
      await pool.end()
    }
  })
})
