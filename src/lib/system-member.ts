// T042 — System Member identifiers
// Source: web/supabase/migrations/002b_system_member.sql
//
// Mirrors the SQL-side constants so app code can reference them without
// hard-coding the UUID everywhere. If you change either side, change both.

export const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001' as const
export const SYSTEM_MEMBER_HANDLE = 'system' as const
