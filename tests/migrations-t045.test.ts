import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T045 — file-shape assertions for the Phase 1 locations spine + 3 children +
// location_events floor. Source: development/tickets/T045-locations-schema.md
// and product/systems/location.md § Spine + child data model.
//
// Numbering note: the rebuild plan calls this 008_*. Renumbered to 007 here
// because locations is the most-independent Phase 1 schema and must land
// before the 007_* member augmentations that FK into it. Recorded in
// DEVIATIONS.md.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T045 — migrations directory state after T045', () => {
  it('contains the six migrations (001, 002, 004, 005, 006, 007)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(expect.arrayContaining([
      '001_extensions.sql',
      '002_members.sql',
      '004_item_embeddings.sql',
      '005_member_embeddings.sql',
      '006_auth_signup_hook.sql',
      '007_locations.sql',
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

describe('T045 — 007_locations.sql: locations spine', () => {
  const raw = read('007_locations.sql')
  const sql = stripComments(raw)

  it('creates the public.locations table', () => {
    expect(sql).toMatch(/create table\s+public\.locations/i)
  })

  it('declares id as uuid primary key with gen_random_uuid()', () => {
    expect(sql).toMatch(/id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i)
  })

  it('declares member_id NOT NULL FK to members.id with on delete restrict', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete restrict/i,
    )
  })

  it('enforces kind enum CHECK (permanent/recurring_temporary/area), no default', () => {
    expect(sql).toMatch(/kind\s+text\s+not null/i)
    expect(sql).toMatch(
      /kind\s+in\s*\(\s*'permanent'\s*,\s*'recurring_temporary'\s*,\s*'area'\s*\)/i,
    )
  })

  it('enforces label NOT NULL with length CHECK (1..120)', () => {
    expect(sql).toMatch(/label\s+text\s+not null/i)
    expect(sql).toMatch(/char_length\(label\)\s+between\s+1\s+and\s+120/i)
  })

  it('enforces slug unique NOT NULL with regex + length CHECK', () => {
    expect(sql).toMatch(/slug\s+text\s+unique\s+not null/i)
    expect(sql).toMatch(/slug\s+~\s+'\^\[a-z0-9-\]\+\$'/i)
    expect(sql).toMatch(/char_length\(slug\)\s+between\s+3\s+and\s+80/i)
  })

  it('declares description with nullable + length CHECK (<=2000)', () => {
    expect(sql).toMatch(/description\s+text/i)
    expect(sql).toMatch(/description is null\s+or\s+char_length\(description\)\s*<=\s*2000/i)
  })

  it('declares geography NOT NULL as geography(Point, 4326)', () => {
    expect(sql).toMatch(/geography\s+geography\s*\(\s*Point\s*,\s*4326\s*\)\s+not null/i)
  })

  it('reserves parent_location_id (nullable, no FK to self yet)', () => {
    expect(sql).toMatch(/parent_location_id\s+uuid/i)
    expect(sql).not.toMatch(/parent_location_id[^,]*references/i)
  })

  it('declares brand_label nullable text', () => {
    expect(sql).toMatch(/brand_label\s+text/i)
  })

  it('declares discoverability enum CHECK with default listed', () => {
    expect(sql).toMatch(/discoverability\s+text\s+not null\s+default\s+'listed'/i)
    expect(sql).toMatch(
      /discoverability\s+in\s*\(\s*'listed'\s*,\s*'unlisted'\s*,\s*'private'\s*\)/i,
    )
  })

  it('declares ambient_extras jsonb NOT NULL default empty', () => {
    expect(sql).toMatch(/ambient_extras\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/i)
  })

  it('reserves embedding_id and federation_origin (nullable, no FK at b1)', () => {
    expect(sql).toMatch(/embedding_id\s+uuid/i)
    expect(sql).toMatch(/federation_origin\s+text/i)
    expect(sql).not.toMatch(/embedding_id[^,]*references/i)
  })

  it('declares soft-delete + timestamp columns', () => {
    expect(sql).toMatch(/deleted_at\s+timestamptz/i)
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('creates the GIST index on geography', () => {
    expect(sql).toMatch(/create index\s+\w+\s+on\s+public\.locations\s+using\s+gist\s*\(\s*geography\s*\)/i)
  })

  it('creates the member_id partial index (where deleted_at is null)', () => {
    expect(sql).toMatch(
      /create index\s+\w+\s+on\s+public\.locations\s*\(\s*member_id\s*\)\s+where\s+deleted_at is null/i,
    )
  })

  it('creates the (kind, discoverability) partial index for listed-locations browse', () => {
    expect(sql).toMatch(
      /create index\s+\w+\s+on\s+public\.locations\s*\(\s*kind\s*,\s*discoverability\s*\)\s+where\s+deleted_at is null\s+and\s+discoverability\s*=\s*'listed'/i,
    )
  })

  it('creates the deleted_at partial index (where deleted_at is null)', () => {
    expect(sql).toMatch(
      /create index\s+\w+\s+on\s+public\.locations\s*\(\s*deleted_at\s*\)\s+where\s+deleted_at is null/i,
    )
  })

  it('attaches an updated_at trigger reusing update_updated_at_column()', () => {
    expect(sql).toMatch(
      /create trigger\s+locations_set_updated_at[\s\S]+update_updated_at_column/i,
    )
  })

  it('enables RLS and creates the public-read + owner-update policies', () => {
    expect(sql).toMatch(/alter table\s+public\.locations\s+enable row level security/i)
    expect(sql).toMatch(
      /create policy\s+locations_public_read[\s\S]+deleted_at is null[\s\S]+discoverability\s+in\s*\(\s*'listed'\s*,\s*'unlisted'\s*\)/i,
    )
    expect(sql).toMatch(
      /create policy\s+locations_owner_update[\s\S]+member_id\s*=\s*auth\.uid\(\)/i,
    )
  })

  it('does NOT create INSERT or DELETE policies on locations (action-layer-only writes)', () => {
    expect(sql).not.toMatch(/policy[^;]+locations[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+locations[^;]+for delete/i)
  })
})

describe('T045 — 007_locations.sql: location_permanent child', () => {
  const sql = stripComments(read('007_locations.sql'))

  it('creates public.location_permanent with location_id PK + FK cascade', () => {
    expect(sql).toMatch(/create table\s+public\.location_permanent/i)
    expect(sql).toMatch(
      /location_id\s+uuid\s+primary key\s+references\s+public\.locations\(id\)\s+on delete cascade/i,
    )
  })

  it('declares street_address (nullable text), public_hours (jsonb), accessibility_notes (<=1000)', () => {
    expect(sql).toMatch(/street_address\s+text/i)
    expect(sql).toMatch(/public_hours\s+jsonb/i)
    expect(sql).toMatch(/accessibility_notes\s+text/i)
    expect(sql).toMatch(
      /accessibility_notes is null\s+or\s+char_length\(accessibility_notes\)\s*<=\s*1000/i,
    )
  })

  it('enables RLS and mirrors spine discoverability via per-child public-read policy', () => {
    expect(sql).toMatch(/alter table\s+public\.location_permanent\s+enable row level security/i)
    expect(sql).toMatch(
      /create policy\s+location_permanent_public_read[\s\S]+select[\s\S]+from\s+public\.locations[\s\S]+discoverability\s+in\s*\(\s*'listed'\s*,\s*'unlisted'\s*\)/i,
    )
  })
})

describe('T045 — 007_locations.sql: location_recurring_temporary child', () => {
  const sql = stripComments(read('007_locations.sql'))

  it('creates public.location_recurring_temporary with location_id PK + FK cascade', () => {
    expect(sql).toMatch(/create table\s+public\.location_recurring_temporary/i)
    expect(sql).toMatch(
      /location_id\s+uuid\s+primary key\s+references\s+public\.locations\(id\)\s+on delete cascade/i,
    )
  })

  it('declares recurrence_rule (text), session_start_time (time), session_end_time (time)', () => {
    expect(sql).toMatch(/recurrence_rule\s+text/i)
    expect(sql).toMatch(/session_start_time\s+time/i)
    expect(sql).toMatch(/session_end_time\s+time/i)
  })

  it('enables RLS and mirrors spine discoverability via per-child public-read policy', () => {
    expect(sql).toMatch(
      /alter table\s+public\.location_recurring_temporary\s+enable row level security/i,
    )
    expect(sql).toMatch(
      /create policy\s+location_recurring_temporary_public_read[\s\S]+select[\s\S]+from\s+public\.locations[\s\S]+discoverability\s+in\s*\(\s*'listed'\s*,\s*'unlisted'\s*\)/i,
    )
  })
})

describe('T045 — 007_locations.sql: location_areas child + centroid trigger', () => {
  const sql = stripComments(read('007_locations.sql'))

  it('creates public.location_areas with location_id PK + FK cascade', () => {
    expect(sql).toMatch(/create table\s+public\.location_areas/i)
    expect(sql).toMatch(
      /location_id\s+uuid\s+primary key\s+references\s+public\.locations\(id\)\s+on delete cascade/i,
    )
  })

  it('declares polygon NOT NULL as geography(Polygon, 4326)', () => {
    expect(sql).toMatch(/polygon\s+geography\s*\(\s*Polygon\s*,\s*4326\s*\)\s+not null/i)
  })

  it('enforces area_kind enum CHECK', () => {
    expect(sql).toMatch(/area_kind\s+text\s+not null/i)
    expect(sql).toMatch(
      /area_kind\s+in\s*\(\s*'service_radius'\s*,\s*'neighborhood'\s*,\s*'city'\s*,\s*'region'\s*,\s*'custom'\s*\)/i,
    )
  })

  it('declares radius_meters as nullable integer', () => {
    expect(sql).toMatch(/radius_meters\s+integer/i)
  })

  it('defines sync_area_centroid() security-definer function with locked search_path', () => {
    expect(sql).toMatch(/create or replace function\s+public\.sync_area_centroid/i)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path\s*=\s*public/i)
    expect(sql).toMatch(/ST_Centroid\s*\(\s*new\.polygon\s*\)/i)
  })

  it('attaches a before insert-or-update trigger on location_areas firing sync_area_centroid', () => {
    expect(sql).toMatch(
      /create trigger\s+\w+\s+before insert or update\s+on\s+public\.location_areas[\s\S]+sync_area_centroid/i,
    )
  })

  it('enables RLS and mirrors spine discoverability via per-child public-read policy', () => {
    expect(sql).toMatch(/alter table\s+public\.location_areas\s+enable row level security/i)
    expect(sql).toMatch(
      /create policy\s+location_areas_public_read[\s\S]+select[\s\S]+from\s+public\.locations[\s\S]+discoverability\s+in\s*\(\s*'listed'\s*,\s*'unlisted'\s*\)/i,
    )
  })
})

describe('T045 — 007_locations.sql: location_events partitioned table', () => {
  const sql = stripComments(read('007_locations.sql'))

  it('creates public.location_events partitioned by range (created_at)', () => {
    expect(sql).toMatch(/create table\s+public\.location_events/i)
    expect(sql).toMatch(/partition by range\s*\(\s*created_at\s*\)/i)
  })

  it('declares location_id FK + on delete cascade', () => {
    expect(sql).toMatch(
      /location_id\s+uuid\s+not null\s+references\s+public\.locations\(id\)\s+on delete cascade/i,
    )
  })

  it('declares acting_member_id NOT NULL FK + on delete restrict', () => {
    expect(sql).toMatch(
      /acting_member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete restrict/i,
    )
  })

  it('declares via_delegation_id (nullable, no FK at b1)', () => {
    expect(sql).toMatch(/via_delegation_id\s+uuid/i)
  })

  it('uses composite PK on (id, created_at) per partition-key inclusion rule', () => {
    expect(sql).toMatch(/primary key\s*\(\s*id\s*,\s*created_at\s*\)/i)
  })

  it('enforces the b1 event_kind enum via CHECK constraint (emitted + reserved)', () => {
    expect(sql).toMatch(/event_kind\s+text\s+not null/i)
    expect(sql).toMatch(/'location\.created'/)
    expect(sql).toMatch(/'location\.updated'/)
    expect(sql).toMatch(/'location\.moved'/)
    expect(sql).toMatch(/'location\.polygon_updated'/)
    expect(sql).toMatch(/'location\.hours_updated'/)
    expect(sql).toMatch(/'location\.deleted'/)
    expect(sql).toMatch(/'location\.restored'/)
    expect(sql).toMatch(/'location\.claim_requested'/)
    expect(sql).toMatch(/'location\.claim_resolved'/)
    expect(sql).toMatch(/'location\.contributor_added'/)
    expect(sql).toMatch(/'location\.followed'/)
    expect(sql).toMatch(/'location\.unfollowed'/)
  })

  it('declares payload jsonb NOT NULL default empty', () => {
    expect(sql).toMatch(/payload\s+jsonb\s+not null\s+default\s+'\{\}'/i)
  })

  it('creates the per-location and per-acting-member indexes', () => {
    expect(sql).toMatch(
      /create index\s+\w+\s+on\s+public\.location_events\s*\(\s*location_id\s*,\s*created_at desc\s*\)/i,
    )
    expect(sql).toMatch(
      /create index\s+\w+\s+on\s+public\.location_events\s*\(\s*acting_member_id\s*,\s*created_at desc\s*\)/i,
    )
  })

  it('enables RLS with read-only owner policy (no INSERT/UPDATE/DELETE policies)', () => {
    expect(sql).toMatch(/alter table\s+public\.location_events\s+enable row level security/i)
    expect(sql).toMatch(
      /create policy\s+location_events_owner_read[\s\S]+for select[\s\S]+location_id in\s*\(\s*select id from public\.locations where member_id\s*=\s*auth\.uid\(\)\s*\)[\s\S]+acting_member_id\s*=\s*auth\.uid\(\)/i,
    )
    expect(sql).not.toMatch(/location_events[^;]+for insert/i)
    expect(sql).not.toMatch(/location_events[^;]+for update/i)
    expect(sql).not.toMatch(/location_events[^;]+for delete/i)
  })

  it('defines the partition-rotation functions and seeds three months', () => {
    expect(sql).toMatch(/create or replace function\s+public\.ensure_location_events_partition/i)
    expect(sql).toMatch(/create or replace function\s+public\.rotate_location_events_partitions/i)
    expect(sql).toMatch(/select\s+public\.rotate_location_events_partitions\(\)/i)
  })
})
