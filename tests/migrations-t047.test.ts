import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T047 — file-shape assertions for the Members augmentation migration:
// FK fortification (home_location_id, members.id via constraint trigger),
// member_privacy (table + RLS + bootstrap trigger + system-Member backfill),
// member_handle_history (T2 placeholder schema). Source ticket:
// development/tickets/T047-members-phase1-fk-privacy-handle-history.md.
//
// Numbering: rebuild plan labeled this 007_*; locations took 007/008, so this
// lands as 009_members_phase1.sql. See DEVIATIONS.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T047 — migrations directory state after T047', () => {
  it('contains the eight migrations (001, 002, 004, 005, 006, 007, 008, 009)', () => {
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

describe('T047 — 009_members_phase1.sql: members FK additions', () => {
  const raw = read('009_members_phase1.sql')
  const sql = stripComments(raw)

  it('adds members_home_location_fkey FK to public.locations(id) on delete set null', () => {
    expect(sql).toMatch(
      /alter table\s+public\.members\s+add constraint\s+members_home_location_fkey\s+foreign key\s*\(\s*home_location_id\s*\)\s+references\s+public\.locations\s*\(\s*id\s*\)\s+on delete set null/i,
    )
  })

  it('uses the not-valid + validate-constraint two-step for the home_location FK', () => {
    expect(sql).toMatch(
      /add constraint\s+members_home_location_fkey[\s\S]+not valid\s*;/i,
    )
    expect(sql).toMatch(
      /alter table\s+public\.members\s+validate constraint\s+members_home_location_fkey/i,
    )
  })

  it('does NOT add a primary_group_id FK in this migration (groups table not yet shipped)', () => {
    expect(sql).not.toMatch(
      /add constraint[^;]+primary_group_id[\s\S]+references\s+public\.groups/i,
    )
    expect(sql).not.toMatch(
      /alter table\s+public\.members[\s\S]+primary_group_id[\s\S]+references\s+public\.groups/i,
    )
  })

  it('defines the assert_member_id_in_auth_users() function', () => {
    expect(sql).toMatch(
      /create or replace function\s+public\.assert_member_id_in_auth_users/i,
    )
  })

  it('marks the assert function security definer with search_path = public, auth', () => {
    const fn = sql.match(
      /create or replace function\s+public\.assert_member_id_in_auth_users[\s\S]+?\$\$;/i,
    )
    expect(fn).not.toBeNull()
    const body = fn![0]
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path\s*=\s*public\s*,\s*auth/i)
  })

  it('assert function exempts the system-Member id and queries auth.users for the rest', () => {
    const fn = sql.match(
      /create or replace function\s+public\.assert_member_id_in_auth_users[\s\S]+?\$\$;/i,
    )!
    const body = fn[0]
    expect(body).toMatch(/00000000-0000-0000-0000-000000000001/)
    expect(body).toMatch(/from\s+auth\.users\s+where\s+id\s*=\s*new\.id/i)
    expect(body).toMatch(/raise/i)
  })

  it('attaches the assert as a constraint trigger AFTER INSERT OR UPDATE OF id, DEFERRABLE INITIALLY DEFERRED', () => {
    expect(sql).toMatch(
      /create constraint trigger\s+members_assert_id_in_auth_users[\s\S]+after insert or update of id\s+on\s+public\.members[\s\S]+deferrable initially deferred/i,
    )
    expect(sql).toMatch(
      /members_assert_id_in_auth_users[\s\S]+execute (?:procedure|function)\s+public\.assert_member_id_in_auth_users/i,
    )
  })
})

describe('T047 — 009_members_phase1.sql: member_privacy table', () => {
  const raw = read('009_members_phase1.sql')
  const sql = stripComments(raw)

  it('creates the public.member_privacy table', () => {
    expect(sql).toMatch(/create table\s+public\.member_privacy/i)
  })

  it('member_id is uuid primary key references members(id) on delete cascade', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+primary key\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('declares profile_visibility with enum CHECK and default public', () => {
    expect(sql).toMatch(/profile_visibility\s+text\s+not null\s+default\s+'public'/i)
    expect(sql).toMatch(
      /profile_visibility\s+in\s*\(\s*'public'\s*,\s*'unlisted'\s*,\s*'members_only'\s*\)/i,
    )
  })

  it('declares the four boolean privacy flags with correct defaults', () => {
    expect(sql).toMatch(/show_items_on_profile\s+boolean\s+not null\s+default\s+true/i)
    expect(sql).toMatch(/show_following\s+boolean\s+not null\s+default\s+false/i)
    expect(sql).toMatch(/show_followers\s+boolean\s+not null\s+default\s+false/i)
    expect(sql).toMatch(/allow_direct_messages\s+boolean\s+not null\s+default\s+true/i)
  })

  it('declares locality_precision with enum CHECK and default city', () => {
    expect(sql).toMatch(/locality_precision\s+text\s+not null\s+default\s+'city'/i)
    expect(sql).toMatch(
      /locality_precision\s+in\s*\(\s*'city'\s*,\s*'neighborhood'\s*,\s*'none'\s*\)/i,
    )
  })

  it('declares updated_at default now()', () => {
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('attaches an updated_at trigger reusing public.update_updated_at_column()', () => {
    expect(sql).toMatch(
      /create trigger\s+member_privacy_set_updated_at[\s\S]+update_updated_at_column/i,
    )
  })

  it('enables RLS with owner-read + owner-update only (no INSERT / DELETE)', () => {
    expect(sql).toMatch(/alter table\s+public\.member_privacy\s+enable row level security/i)
    expect(sql).toMatch(
      /create policy\s+member_privacy_owner_read[\s\S]+for select[\s\S]+member_id\s*=\s*auth\.uid\(\)/i,
    )
    expect(sql).toMatch(
      /create policy\s+member_privacy_owner_update[\s\S]+for update[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)[\s\S]+with check\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i,
    )
    expect(sql).not.toMatch(/policy[^;]+member_privacy[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_privacy[^;]+for delete/i)
  })
})

describe('T047 — 009_members_phase1.sql: bootstrap trigger', () => {
  const raw = read('009_members_phase1.sql')
  const sql = stripComments(raw)

  it('defines public.create_member_privacy_defaults() with security definer + search_path = public', () => {
    const fn = sql.match(
      /create or replace function\s+public\.create_member_privacy_defaults[\s\S]+?\$\$;/i,
    )
    expect(fn).not.toBeNull()
    const body = fn![0]
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path\s*=\s*public/i)
    expect(body).toMatch(/insert into\s+public\.member_privacy[\s\S]+new\.id/i)
    expect(body).toMatch(/on conflict[\s\S]+do nothing/i)
  })

  it('attaches the bootstrap trigger AFTER INSERT on public.members', () => {
    expect(sql).toMatch(
      /create trigger\s+members_create_privacy_defaults\s+after insert\s+on\s+public\.members\s+for each row\s+execute (?:procedure|function)\s+public\.create_member_privacy_defaults/i,
    )
  })

  it('documents the bootstrap function with comment on function', () => {
    expect(sql).toMatch(
      /comment on function\s+public\.create_member_privacy_defaults\(\)\s+is/i,
    )
  })

  it('backfills member_privacy for the system Member with on conflict do nothing', () => {
    expect(raw).toMatch(
      /insert into\s+public\.member_privacy[\s\S]*\(\s*member_id\s*\)[\s\S]*'00000000-0000-0000-0000-000000000001'[\s\S]*on conflict[\s\S]*do nothing/i,
    )
  })
})

describe('T047 — 009_members_phase1.sql: member_handle_history table', () => {
  const raw = read('009_members_phase1.sql')
  const sql = stripComments(raw)

  it('creates the public.member_handle_history table', () => {
    expect(sql).toMatch(/create table\s+public\.member_handle_history/i)
  })

  it('declares member_id with FK + on delete cascade', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('enforces the handle regex + length CHECK', () => {
    expect(sql).toMatch(/handle\s+text\s+not null/i)
    expect(sql).toMatch(/char_length\(handle\)\s+between\s+4\s+and\s+30/i)
    expect(sql).toMatch(/handle\s+~\s+'\^\[a-z0-9-\]\+\$'/i)
  })

  it('declares changed_at timestamptz default now() and a composite PK on (member_id, handle)', () => {
    expect(sql).toMatch(/changed_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/primary key\s*\(\s*member_id\s*,\s*handle\s*\)/i)
  })

  it('does not create any non-PK index on member_handle_history', () => {
    expect(sql).not.toMatch(/create index[^;]+member_handle_history/i)
  })

  it('enables RLS with owner-read only (no INSERT / UPDATE / DELETE policy)', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_handle_history\s+enable row level security/i,
    )
    expect(sql).toMatch(
      /create policy\s+member_handle_history_owner_read[\s\S]+for select[\s\S]+member_id\s*=\s*auth\.uid\(\)/i,
    )
    expect(sql).not.toMatch(/policy[^;]+member_handle_history[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_handle_history[^;]+for update/i)
    expect(sql).not.toMatch(/policy[^;]+member_handle_history[^;]+for delete/i)
  })
})
