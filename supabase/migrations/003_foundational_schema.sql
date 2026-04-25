-- 003_foundational_schema.sql
-- T022: Foundational schema for events, vendor bulletins, vendor analytics, follow soft-delete.
-- Infrastructure-only — no UI surface depends on this until T024+.

-- =============================================================================
-- 1. follows: soft-delete + activity tracking
-- =============================================================================

alter table follows add column if not exists last_active_at timestamptz;
alter table follows add column if not exists unfollowed_at timestamptz;

create index if not exists idx_follows_active on follows (user_id, vendor_id) where unfollowed_at is null;

-- Replace public follower-count view to count only active follows
create or replace view vendor_follower_counts as
  select vendor_id, count(*)::int as follower_count
  from follows
  where unfollowed_at is null
  group by vendor_id;

grant select on vendor_follower_counts to anon, authenticated;

-- Allow owner to update their own follow row (needed for soft-delete via update)
create policy "follows_update" on follows for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 2. events: unified time-stamped object (markets, classes, projects, vendor specials)
-- =============================================================================

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('market_session','class','community_project','vendor_special')),
  host_type text not null check (host_type in ('vendor','market','platform')),
  host_id uuid not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  recurrence jsonb,
  location_lat numeric not null,
  location_lng numeric not null,
  location_label text,
  cost_cents int,
  capacity int,
  cover_photo_url text,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_events_starts_at on events (starts_at);
create index if not exists idx_events_host on events (host_type, host_id);
create index if not exists idx_events_type_starts on events (event_type, starts_at);
-- Idempotency for generated market_session rows
create unique index if not exists idx_events_market_session_unique
  on events (host_id, starts_at) where event_type = 'market_session';

alter table events enable row level security;
create policy "events_select" on events for select using (true);
create policy "events_insert_owner" on events for insert with check (
  (host_type = 'vendor' and exists (select 1 from businesses b where b.id = host_id and b.user_id = auth.uid()))
);
create policy "events_update_owner" on events for update using (
  host_type = 'vendor' and exists (select 1 from businesses b where b.id = host_id and b.user_id = auth.uid())
);
create policy "events_delete_owner" on events for delete using (
  host_type = 'vendor' and exists (select 1 from businesses b where b.id = host_id and b.user_id = auth.uid())
);

-- =============================================================================
-- 3. generate_market_sessions: idempotent materialization of recurring market events
-- =============================================================================

create or replace function generate_market_sessions(window_days int default 14)
returns int
language plpgsql
security definer
as $$
declare
  inserted int := 0;
  m record;
  d date;
  weekday_slug text;
  start_ts timestamptz;
  end_ts timestamptz;
  weekday_map jsonb := '{"sun":0,"mon":1,"tue":2,"wed":3,"thu":4,"fri":5,"sat":6}'::jsonb;
begin
  for m in select id, name, latitude, longitude, schedule_days, schedule_start_time, schedule_end_time
           from markets loop
    for d in select generate_series(current_date, current_date + (window_days - 1), interval '1 day')::date loop
      weekday_slug := lower(to_char(d, 'dy'));
      if m.schedule_days @> array[weekday_slug] then
        start_ts := (d::text || ' ' || coalesce(m.schedule_start_time, '09:00') || ':00')::timestamptz;
        end_ts := case when m.schedule_end_time is not null
                       then (d::text || ' ' || m.schedule_end_time || ':00')::timestamptz
                       else null end;
        insert into events (event_type, host_type, host_id, title, starts_at, ends_at,
                            location_lat, location_lng, location_label)
        values ('market_session', 'market', m.id, m.name, start_ts, end_ts,
                m.latitude, m.longitude, m.name)
        on conflict (host_id, starts_at) where event_type = 'market_session' do nothing;
        if found then inserted := inserted + 1; end if;
      end if;
    end loop;
  end loop;
  return inserted;
end;
$$;

-- =============================================================================
-- 4. vendor_bulletins + bulletin_deliveries
-- =============================================================================

create table if not exists vendor_bulletins (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references businesses(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  body text not null,
  cover_photo_url text,
  attached_event_id uuid references events(id) on delete set null,
  published_at timestamptz,
  audience text not null default 'all_followers' check (audience = 'all_followers'),
  delivery_channels jsonb not null default '{"in_app": true, "email": true, "push": false}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vendor_bulletins_vendor_published
  on vendor_bulletins (vendor_id, published_at desc);

alter table vendor_bulletins enable row level security;
create policy "vendor_bulletins_select" on vendor_bulletins for select using (
  published_at is not null
  or exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid())
);
create policy "vendor_bulletins_insert_owner" on vendor_bulletins for insert with check (
  exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid())
);
create policy "vendor_bulletins_update_owner" on vendor_bulletins for update using (
  exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid())
);
create policy "vendor_bulletins_delete_owner" on vendor_bulletins for delete using (
  exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid())
);

create table if not exists bulletin_deliveries (
  bulletin_id uuid not null references vendor_bulletins(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  opened_at timestamptz,
  clicked_at timestamptz,
  unsubscribed_at timestamptz,
  primary key (bulletin_id, user_id)
);

create index if not exists idx_bulletin_deliveries_user_delivered
  on bulletin_deliveries (user_id, delivered_at desc);

alter table bulletin_deliveries enable row level security;
-- Recipient can read their own delivery; vendor owner can read all deliveries for their bulletin
create policy "bulletin_deliveries_select" on bulletin_deliveries for select using (
  auth.uid() = user_id
  or exists (
    select 1 from vendor_bulletins vb join businesses b on b.id = vb.vendor_id
    where vb.id = bulletin_id and b.user_id = auth.uid()
  )
);
-- Recipient can update their own row (mark opened/clicked/unsubscribe)
create policy "bulletin_deliveries_update_self" on bulletin_deliveries for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- 5. vendor_events: append-only analytics log
-- =============================================================================

create table if not exists vendor_events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (event_name in (
    'profile_view','support_click','follow','unfollow','share','bulletin_open','bulletin_click','bulletin_published'
  )),
  referrer text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vendor_events_vendor_created on vendor_events (vendor_id, created_at desc);
create index if not exists idx_vendor_events_vendor_name_created on vendor_events (vendor_id, event_name, created_at desc);

alter table vendor_events enable row level security;
-- Anyone (including anon) can insert their own analytics rows
create policy "vendor_events_insert" on vendor_events for insert with check (
  user_id is null or auth.uid() = user_id
);
-- Only vendor owner can read their analytics
create policy "vendor_events_select_owner" on vendor_events for select using (
  exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid())
);

-- =============================================================================
-- 6. vendor_stats_daily: denormalized rollup (populated by future scheduled job)
-- =============================================================================

create table if not exists vendor_stats_daily (
  vendor_id uuid not null references businesses(id) on delete cascade,
  day date not null,
  profile_views int not null default 0,
  support_clicks int not null default 0,
  new_follows int not null default 0,
  unfollows int not null default 0,
  shares int not null default 0,
  bulletin_opens int not null default 0,
  primary key (vendor_id, day)
);

create index if not exists idx_vendor_stats_daily_vendor_day on vendor_stats_daily (vendor_id, day desc);

alter table vendor_stats_daily enable row level security;
create policy "vendor_stats_daily_select_owner" on vendor_stats_daily for select using (
  exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid())
);
