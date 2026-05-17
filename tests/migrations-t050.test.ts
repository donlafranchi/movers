import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T050 — file-shape assertions for the agent-assistance substrate migration.
// Source ticket: development/tickets/T050-member-agent-assistance-substrate.md.
// Spec: product/systems/member.md lines 368-394 (member_self_records,
// member_delegations) + lines 402-407 (audit fields).
// FK retrofits close the via_delegation_id circle on member_events (T042)
// and location_events (T045) — both reserved the column without FK while
// member_delegations did not yet exist.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T050 — migrations directory state after T050', () => {
  it('contains 012_member_agent_assistance.sql alongside the prior Phase 1 set', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual([
      '001_extensions.sql',
      '002_members.sql',
      '004_item_embeddings.sql',
      '005_member_embeddings.sql',
      '006_auth_signup_hook.sql',
      '007_locations.sql',
      '008_locations_owner_read.sql',
      '009_members_phase1.sql',
      '010_member_interests_follows.sql',
      '011_member_location_affinities.sql',
      '012_member_agent_assistance.sql',
    ])
  })
})

describe('T050 — 012_member_agent_assistance.sql: member_self_records shape', () => {
  const raw = read('012_member_agent_assistance.sql')
  const sql = stripComments(raw)

  it('creates public.member_self_records', () => {
    expect(sql).toMatch(/create table\s+public\.member_self_records/i)
  })

  it('declares member_id as primary key FK to public.members(id) on delete cascade', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+primary key\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('declares document jsonb NOT NULL default empty object', () => {
    expect(sql).toMatch(
      /document\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/i,
    )
  })

  it("declares scratch_or_full text NOT NULL default 'scratch' with CHECK", () => {
    expect(sql).toMatch(
      /scratch_or_full\s+text\s+not null\s+default\s+'scratch'\s+check\s*\(\s*scratch_or_full\s+in\s*\(\s*'scratch'\s*,\s*'full'\s*\)\s*\)/i,
    )
  })

  it('declares updated_at timestamptz NOT NULL default now()', () => {
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('attaches update_updated_at_column trigger on member_self_records', () => {
    expect(sql).toMatch(
      /create trigger\s+member_self_records_set_updated_at\s+before update\s+on\s+public\.member_self_records\s+for each row execute function\s+public\.update_updated_at_column\(\)/i,
    )
  })

  it('enables RLS on member_self_records', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_self_records\s+enable row level security/i,
    )
  })

  it('defines owner-read policy keyed by auth.uid()', () => {
    expect(sql).toMatch(
      /create policy\s+member_self_records_owner_read[\s\S]+for select[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i,
    )
  })

  it('defines owner-update policy keyed by auth.uid()', () => {
    expect(sql).toMatch(
      /create policy\s+member_self_records_owner_update[\s\S]+for update[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i,
    )
  })

  it('does NOT define INSERT or DELETE policies on member_self_records (action-layer-only)', () => {
    expect(sql).not.toMatch(/policy[^;]+member_self_records[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_self_records[^;]+for delete/i)
  })

  it('does NOT create a bootstrap trigger on members for member_self_records', () => {
    // Per ticket — rows only land when the Member opts into agent assistance.
    // The legitimate member_self_records_set_updated_at trigger fires BEFORE
    // UPDATE on public.member_self_records itself; it must not match this
    // negative check, which targets only triggers on public.members.
    expect(sql).not.toMatch(
      /create\s+trigger\s+\w+\s+(after|before)\s+(insert|update)[^;]*\s+on\s+public\.members\b[\s\S]*?member_self_records/i,
    )
    expect(sql).not.toMatch(/insert\s+into\s+public\.member_self_records/i)
  })
})

describe('T050 — 012_member_agent_assistance.sql: member_delegations shape', () => {
  const raw = read('012_member_agent_assistance.sql')
  const sql = stripComments(raw)

  it('creates public.member_delegations', () => {
    expect(sql).toMatch(/create table\s+public\.member_delegations/i)
  })

  it('declares id uuid primary key default gen_random_uuid()', () => {
    expect(sql).toMatch(/id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i)
  })

  it('declares member_id uuid NOT NULL FK to members on delete cascade', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('declares grantee_label text NOT NULL with length CHECK (1..120)', () => {
    expect(sql).toMatch(
      /grantee_label\s+text\s+not null\s+check\s*\(\s*char_length\(grantee_label\)\s+between\s+1\s+and\s+120\s*\)/i,
    )
  })

  it('declares scopes text[] NOT NULL with array_length >= 1 CHECK', () => {
    expect(sql).toMatch(
      /scopes\s+text\[\]\s+not null\s+check\s*\(\s*array_length\(scopes\s*,\s*1\)\s*>=\s*1\s*\)/i,
    )
  })

  it('declares granted_at timestamptz NOT NULL default now()', () => {
    expect(sql).toMatch(/granted_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('declares expires_at timestamptz nullable', () => {
    expect(sql).toMatch(/expires_at\s+timestamptz\b(?!\s*not null)/i)
  })

  it('declares revoked_at timestamptz nullable', () => {
    expect(sql).toMatch(/revoked_at\s+timestamptz\b(?!\s*not null)/i)
  })

  it('declares metadata jsonb NOT NULL default empty object', () => {
    expect(sql).toMatch(/metadata\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/i)
  })

  it('creates simplified idx_delegations_member_active (no now() predicate)', () => {
    expect(sql).toMatch(
      /create index\s+idx_delegations_member_active\s+on\s+public\.member_delegations\s*\(\s*member_id\s*\)\s+where\s+revoked_at is null\s*;/i,
    )
  })

  it('does NOT include expires_at > now() in the partial-index predicate', () => {
    expect(sql).not.toMatch(/idx_delegations_member_active[\s\S]+expires_at\s*>\s*now\(\)/i)
  })

  it('enables RLS on member_delegations', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_delegations\s+enable row level security/i,
    )
  })

  it('defines exactly one owner-read policy keyed by auth.uid()', () => {
    expect(sql).toMatch(
      /create policy\s+member_delegations_owner_read[\s\S]+for select[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i,
    )
  })

  it('does NOT define a public-read or peer-read policy on member_delegations', () => {
    expect(sql).not.toMatch(
      /create policy[^;]+member_delegations[^;]+for select[\s\S]+using\s*\(\s*true\s*\)/i,
    )
    expect(sql).not.toMatch(/create policy\s+member_delegations_(public|peer)_read/i)
  })

  it('does NOT define INSERT / UPDATE / DELETE policies on member_delegations (action-layer-only)', () => {
    expect(sql).not.toMatch(/policy[^;]+member_delegations[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_delegations[^;]+for update/i)
    expect(sql).not.toMatch(/policy[^;]+member_delegations[^;]+for delete/i)
  })
})

describe('T050 — 012_member_agent_assistance.sql: FK retrofits (close via_delegation_id circle)', () => {
  const raw = read('012_member_agent_assistance.sql')
  const sql = stripComments(raw)

  it('adds member_events_via_delegation_fkey with not valid + on delete set null', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_events\s+add constraint\s+member_events_via_delegation_fkey\s+foreign key\s*\(\s*via_delegation_id\s*\)\s+references\s+public\.member_delegations\s*\(\s*id\s*\)\s+on delete set null\s+not valid/i,
    )
  })

  it('validates member_events_via_delegation_fkey as the second step', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_events\s+validate constraint\s+member_events_via_delegation_fkey/i,
    )
  })

  it('adds location_events_via_delegation_fkey with not valid + on delete set null', () => {
    expect(sql).toMatch(
      /alter table\s+public\.location_events\s+add constraint\s+location_events_via_delegation_fkey\s+foreign key\s*\(\s*via_delegation_id\s*\)\s+references\s+public\.member_delegations\s*\(\s*id\s*\)\s+on delete set null\s+not valid/i,
    )
  })

  it('validates location_events_via_delegation_fkey as the second step', () => {
    expect(sql).toMatch(
      /alter table\s+public\.location_events\s+validate constraint\s+location_events_via_delegation_fkey/i,
    )
  })
})
