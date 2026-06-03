import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T048 — file-shape assertions for member_interests + member_follows.
// Source ticket: development/tickets/T048-member-interests-and-follows.md.
// Numbering: rebuild plan labeled this 007b + 007c; consolidated to 010_*
// per the same renumbering recorded in T047's DEVIATIONS.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T048 — migrations directory state after T048', () => {
  it('contains the nine migrations (001, 002, 004, 005, 006, 007, 008, 009, 010)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(expect.arrayContaining([
      '001_extensions.sql',
      '002_members.sql',
      '004_item_embeddings.sql',
      '005_member_embeddings.sql',
      '006_auth_signup_hook.sql',
      '007_locations.sql',
      '008_locations_owner_read.sql',
      '009_members_phase1.sql',
      '010_member_interests_follows.sql',
      '030_member_discoverability.sql',
    ]))
  })
})

describe('T048 — 010_member_interests_follows.sql: member_interests', () => {
  const raw = read('010_member_interests_follows.sql')
  const sql = stripComments(raw)

  it('creates the public.member_interests table', () => {
    expect(sql).toMatch(/create table\s+public\.member_interests/i)
  })

  it('declares member_id NOT NULL FK with on delete cascade', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('declares tag with regex + length CHECK', () => {
    expect(sql).toMatch(/tag\s+text\s+not null/i)
    expect(sql).toMatch(/char_length\(tag\)\s+between\s+1\s+and\s+60/i)
    expect(sql).toMatch(/tag\s+~\s+'\^\[a-z0-9-\]\+\$'/i)
  })

  it('declares created_at default now() and a composite PK on (member_id, tag)', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/primary key\s*\(\s*member_id\s*,\s*tag\s*\)/i)
  })

  it('creates idx_member_interests_tag on (tag) for the inverse lookup', () => {
    expect(sql).toMatch(
      /create index\s+idx_member_interests_tag\s+on\s+public\.member_interests\s*\(\s*tag\s*\)/i,
    )
  })

  it('enables RLS with public-read policy and no write policies', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_interests\s+enable row level security/i,
    )
    expect(sql).toMatch(
      /create policy\s+member_interests_public_read[\s\S]+for select[\s\S]+using\s*\(\s*true\s*\)/i,
    )
    expect(sql).not.toMatch(/policy[^;]+member_interests[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_interests[^;]+for update/i)
    expect(sql).not.toMatch(/policy[^;]+member_interests[^;]+for delete/i)
  })
})

describe('T048 — 010_member_interests_follows.sql: member_follows', () => {
  const raw = read('010_member_interests_follows.sql')
  const sql = stripComments(raw)

  it('creates the public.member_follows table', () => {
    expect(sql).toMatch(/create table\s+public\.member_follows/i)
  })

  it('declares follower_member_id and followed_member_id with FK + on delete cascade', () => {
    expect(sql).toMatch(
      /follower_member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
    expect(sql).toMatch(
      /followed_member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('declares created_at default now() and unfollowed_at nullable (soft-unfollow)', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/unfollowed_at\s+timestamptz\b(?!\s*not null)/i)
  })

  it('declares composite PK on (follower_member_id, followed_member_id)', () => {
    expect(sql).toMatch(
      /primary key\s*\(\s*follower_member_id\s*,\s*followed_member_id\s*\)/i,
    )
  })

  it('enforces a no-self-follow CHECK', () => {
    expect(sql).toMatch(
      /check\s*\(\s*follower_member_id\s*<>\s*followed_member_id\s*\)/i,
    )
  })

  it('creates idx_follows_followed_active partial on (followed_member_id) where unfollowed_at is null', () => {
    expect(sql).toMatch(
      /create index\s+idx_follows_followed_active\s+on\s+public\.member_follows\s*\(\s*followed_member_id\s*\)\s+where\s+unfollowed_at is null/i,
    )
  })

  it('creates idx_follows_follower_active partial on (follower_member_id) where unfollowed_at is null', () => {
    expect(sql).toMatch(
      /create index\s+idx_follows_follower_active\s+on\s+public\.member_follows\s*\(\s*follower_member_id\s*\)\s+where\s+unfollowed_at is null/i,
    )
  })

  it('enables RLS', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_follows\s+enable row level security/i,
    )
  })

  it('defines member_follows_public_read as fully public (using true)', () => {
    expect(sql).toMatch(
      /create policy\s+member_follows_public_read[\s\S]+for select[\s\S]+using\s*\(\s*true\s*\)/i,
    )
  })

  it('does NOT define a privacy-gated public-read policy (no EXISTS on member_privacy)', () => {
    // Per the 2026-05-11 product decision, follow graph is community-fabric.
    // Cross-Member privacy work lands on member_location_affinities (T049).
    expect(sql).not.toMatch(/member_privacy[\s\S]+show_following\s*=\s*true/i)
    expect(sql).not.toMatch(/member_privacy[\s\S]+show_followers\s*=\s*true/i)
  })

  it('does NOT define a separate self-read policy (subsumed by public_read)', () => {
    expect(sql).not.toMatch(/create policy\s+member_follows_self_read/i)
  })

  it('has no INSERT / UPDATE / DELETE policy on member_follows', () => {
    expect(sql).not.toMatch(/policy[^;]+member_follows[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_follows[^;]+for update/i)
    expect(sql).not.toMatch(/policy[^;]+member_follows[^;]+for delete/i)
  })
})
