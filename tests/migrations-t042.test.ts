import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T042 — file-shape assertions for the Phase 0 members + member_events
// floor + system Member row. Originally split into 002 + 002a + 002b, then
// consolidated into a single 002_members.sql when Supabase CLI was found
// to reject alpha-suffixed numbering ("file name must match pattern
// <timestamp>_name.sql"). The three logical sections still test
// independently against the same file.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')
const SRC_DIR = resolve(__dirname, '..', 'src')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T042 — migrations directory state after T042', () => {
  it('contains the T041 + T042 set after this ticket (consolidated 002)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(expect.arrayContaining([
      '001_extensions.sql',
      '002_members.sql',
      '004_item_embeddings.sql',
      '005_member_embeddings.sql',
      '030_member_discoverability.sql',
    ]))
  })

  it('has no alpha-suffixed migration filenames (Supabase CLI rejects them)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    for (const f of files) {
      expect(f).toMatch(/^\d+_[a-z0-9_]+\.sql$/i)
    }
  })
})

describe('T042 — 002_members.sql: members section', () => {
  const raw = read('002_members.sql')
  const sql = stripComments(raw)

  it('creates the public.members table', () => {
    expect(sql).toMatch(/create table\s+public\.members/i)
  })

  it('declares id as uuid primary key with gen_random_uuid()', () => {
    expect(sql).toMatch(/id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i)
  })

  it('does NOT declare a FK from members.id to auth.users (deferred to Phase 1)', () => {
    expect(sql).not.toMatch(/id\s+uuid[^,]*references\s+auth\.users/i)
  })

  it('enforces handle regex and length via CHECK constraint', () => {
    expect(sql).toMatch(/handle\s+text\s+unique\s+not null/i)
    expect(sql).toMatch(/handle\s+~\s+'\^\[a-z0-9-\]\+\$'/i)
    expect(sql).toMatch(/char_length\(handle\)\s+between\s+4\s+and\s+30/i)
  })

  it('enforces display_name length CHECK', () => {
    expect(sql).toMatch(/display_name\s+text\s+not null/i)
    expect(sql).toMatch(/char_length\(display_name\)\s+between\s+1\s+and\s+60/i)
  })

  it('reserves home_location_id and primary_group_id WITHOUT a FK', () => {
    expect(sql).toMatch(/home_location_id\s+uuid/i)
    expect(sql).toMatch(/primary_group_id\s+uuid/i)
    expect(sql).not.toMatch(/home_location_id[^,]*references/i)
    expect(sql).not.toMatch(/primary_group_id[^,]*references/i)
  })

  it('declares stakeholder_visibility with enum CHECK and default private', () => {
    expect(sql).toMatch(/stakeholder_visibility\s+text\s+not null\s+default\s+'private'/i)
    expect(sql).toMatch(/stakeholder_visibility\s+in\s*\(\s*'private'\s*,\s*'community_only'\s*,\s*'public'\s*\)/i)
  })

  it('declares maker_mode_enabled boolean default false', () => {
    expect(sql).toMatch(/maker_mode_enabled\s+boolean\s+not null\s+default\s+false/i)
  })

  it('declares login_disabled boolean default false (system-Member gate)', () => {
    expect(sql).toMatch(/login_disabled\s+boolean\s+not null\s+default\s+false/i)
  })

  it('declares soft-delete and timestamp columns', () => {
    expect(sql).toMatch(/deleted_at\s+timestamptz/i)
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('creates the partial indexes per the ticket', () => {
    expect(sql).toMatch(/create index\s+idx_members_home_location.+where\s+home_location_id is not null/is)
    expect(sql).toMatch(/create index\s+idx_members_primary_group.+where\s+primary_group_id is not null/is)
    expect(sql).toMatch(/create index\s+idx_members_active.+where\s+deleted_at is null/is)
  })

  it('attaches an updated_at trigger', () => {
    expect(sql).toMatch(/create or replace function\s+public\.update_updated_at_column/i)
    expect(sql).toMatch(/create trigger\s+members_set_updated_at[\s\S]+update_updated_at_column/i)
  })

  it('enables RLS and creates the public-read + owner-update policies', () => {
    expect(sql).toMatch(/alter table\s+public\.members\s+enable row level security/i)
    expect(sql).toMatch(/create policy\s+members_public_read[\s\S]+deleted_at is null[\s\S]+login_disabled\s*=\s*false/i)
    expect(sql).toMatch(/create policy\s+members_owner_update[\s\S]+id\s*=\s*auth\.uid\(\)/i)
  })

  it('does NOT create an INSERT or DELETE policy on members (action-layer-only writes)', () => {
    expect(sql).not.toMatch(/policy[^;]+members[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+members[^;]+for delete/i)
  })
})

describe('T042 — 002_members.sql: member_events section', () => {
  const raw = read('002_members.sql')
  const sql = stripComments(raw)

  it('creates public.member_events partitioned by range (created_at)', () => {
    expect(sql).toMatch(/create table\s+public\.member_events/i)
    expect(sql).toMatch(/partition by range\s*\(\s*created_at\s*\)/i)
  })

  it('declares acting_member_id NOT NULL with FK + on delete restrict', () => {
    expect(sql).toMatch(/acting_member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete restrict/i)
  })

  it('declares via_delegation_id (nullable, no FK at Phase 0)', () => {
    expect(sql).toMatch(/via_delegation_id\s+uuid/i)
  })

  it('declares member_id with FK + on delete cascade', () => {
    expect(sql).toMatch(/member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i)
  })

  it('uses composite PK on (id, created_at) per partition-key inclusion rule', () => {
    expect(sql).toMatch(/primary key\s*\(\s*id\s*,\s*created_at\s*\)/i)
  })

  it('enforces the b1 event_kind enum via CHECK constraint', () => {
    expect(sql).toMatch(/event_kind\s+text\s+not null/i)
    expect(sql).toMatch(/'member\.created'/)
    expect(sql).toMatch(/'member\.profile_updated'/)
    expect(sql).toMatch(/'member\.maker_mode_changed'/)
    expect(sql).toMatch(/'member\.location_affinity_added'/)
    expect(sql).toMatch(/'member\.delegation_granted'/)
    expect(sql).toMatch(/'member\.export_requested'/)
  })

  it('declares payload jsonb not null default empty', () => {
    expect(sql).toMatch(/payload\s+jsonb\s+not null\s+default\s+'\{\}'/i)
  })

  it('creates the per-member and per-acting-member indexes', () => {
    expect(sql).toMatch(/create index\s+idx_member_events_member\s+on\s+public\.member_events\s*\(\s*member_id\s*,\s*created_at desc\s*\)/i)
    expect(sql).toMatch(/create index\s+idx_member_events_acting\s+on\s+public\.member_events\s*\(\s*acting_member_id\s*,\s*created_at desc\s*\)/i)
  })

  it('enables RLS with read-only policy (no INSERT / UPDATE / DELETE on events)', () => {
    expect(sql).toMatch(/alter table\s+public\.member_events\s+enable row level security/i)
    expect(sql).toMatch(/create policy\s+member_events_owner_read[\s\S]+for select/i)
    expect(sql).not.toMatch(/member_events[^;]+for insert/i)
    expect(sql).not.toMatch(/member_events[^;]+for update/i)
    expect(sql).not.toMatch(/member_events[^;]+for delete/i)
  })

  it('defines the partition-rotation functions and seeds three months', () => {
    expect(sql).toMatch(/create or replace function\s+public\.ensure_member_events_partition/i)
    expect(sql).toMatch(/create or replace function\s+public\.rotate_member_events_partitions/i)
    expect(sql).toMatch(/select\s+public\.rotate_member_events_partitions\(\)/i)
  })
})

describe('T042 — 002_members.sql: system Member section', () => {
  const raw = read('002_members.sql')

  it('inserts the system Member row with the well-known id', () => {
    expect(raw).toMatch(/insert into\s+public\.members[\s\S]+'00000000-0000-0000-0000-000000000001'/i)
    expect(raw).toMatch(/'system'/)
    expect(raw).toMatch(/'System'/)
  })

  it('is idempotent via on conflict do nothing', () => {
    expect(raw).toMatch(/on conflict\s*\(\s*id\s*\)\s+do nothing/i)
  })

  it('inserts the self-bootstrap member.created event', () => {
    expect(raw).toMatch(/insert into\s+public\.member_events[\s\S]+'member\.created'/i)
    const sysId = '00000000-0000-0000-0000-000000000001'
    const occurrences = (raw.match(new RegExp(sysId, 'g')) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(3)
  })
})

describe('T042 — TypeScript system-member constants', () => {
  const tsPath = resolve(SRC_DIR, 'lib', 'system-member.ts')

  it('exists at web/src/lib/system-member.ts', () => {
    expect(existsSync(tsPath)).toBe(true)
  })

  it('exports SYSTEM_MEMBER_ID matching the SQL constant', () => {
    const ts = readFileSync(tsPath, 'utf8')
    expect(ts).toMatch(/SYSTEM_MEMBER_ID\s*=\s*['"]00000000-0000-0000-0000-000000000001['"]/i)
  })

  it('exports SYSTEM_MEMBER_HANDLE = "system"', () => {
    const ts = readFileSync(tsPath, 'utf8')
    expect(ts).toMatch(/SYSTEM_MEMBER_HANDLE\s*=\s*['"]system['"]/i)
  })
})
