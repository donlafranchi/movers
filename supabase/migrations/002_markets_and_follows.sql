-- 002_markets_and_follows.sql
-- Farmers market pivot: markets, vendor-market links, product categories, follows

-- Add featured + product category tracking to existing businesses (now treated as vendors)
alter table businesses add column if not exists is_featured boolean not null default false;
alter table businesses add column if not exists featured_at timestamptz;
alter table businesses add column if not exists tagline text;
alter table businesses add column if not exists cover_photo_url text;
alter table businesses add column if not exists website_url text;
alter table businesses add column if not exists instagram_handle text;
alter table businesses add column if not exists contact_email text;

create index if not exists idx_businesses_featured on businesses (is_featured, featured_at desc);

-- Markets
create table markets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  city text not null,
  state text not null,
  latitude numeric not null,
  longitude numeric not null,
  schedule_days text[] not null default '{}',
  schedule_start_time text,
  schedule_end_time text,
  description text,
  created_at timestamptz not null default now()
);

create index idx_markets_location on markets (latitude, longitude);
create index idx_markets_slug on markets (slug);

-- Vendor <-> Market (many-to-many)
create table market_vendors (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  vendor_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (market_id, vendor_id)
);

create index idx_market_vendors_market on market_vendors (market_id);
create index idx_market_vendors_vendor on market_vendors (vendor_id);

-- Vendor product categories (one vendor can have many category tags)
create table vendor_categories (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references businesses(id) on delete cascade,
  category_slug text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (vendor_id, category_slug)
);

create index idx_vendor_categories_vendor on vendor_categories (vendor_id);
create index idx_vendor_categories_slug on vendor_categories (category_slug);

-- Follows (user -> vendor)
create table follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, vendor_id)
);

create index idx_follows_user on follows (user_id);
create index idx_follows_vendor on follows (vendor_id);

-- User preferences (selected market)
create table user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_market_id uuid references markets(id) on delete set null,
  follow_emails_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Follow notification dedupe ledger
create table follow_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references businesses(id) on delete cascade,
  market_id uuid not null references markets(id) on delete cascade,
  market_date date not null,
  sent_at timestamptz not null default now(),
  unique (user_id, vendor_id, market_id, market_date)
);

-- RLS
alter table markets enable row level security;
alter table market_vendors enable row level security;
alter table vendor_categories enable row level security;
alter table follows enable row level security;
alter table user_preferences enable row level security;
alter table follow_notifications enable row level security;

-- Markets: readable by all
create policy "markets_select" on markets for select using (true);

-- Market_vendors: readable by all, writable by vendor owner
create policy "market_vendors_select" on market_vendors for select using (true);
create policy "market_vendors_insert" on market_vendors for insert
  with check (exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid()));
create policy "market_vendors_delete" on market_vendors for delete
  using (exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid()));

-- Vendor_categories: readable by all, writable by vendor owner
create policy "vendor_categories_select" on vendor_categories for select using (true);
create policy "vendor_categories_insert" on vendor_categories for insert
  with check (exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid()));
create policy "vendor_categories_delete" on vendor_categories for delete
  using (exists (select 1 from businesses b where b.id = vendor_id and b.user_id = auth.uid()));

-- Follows: readable by owner, writable by owner
create policy "follows_select" on follows for select using (auth.uid() = user_id);
create policy "follows_insert" on follows for insert with check (auth.uid() = user_id);
create policy "follows_delete" on follows for delete using (auth.uid() = user_id);

-- Vendor-facing follower count: public aggregate
create or replace view vendor_follower_counts as
  select vendor_id, count(*)::int as follower_count
  from follows
  group by vendor_id;

grant select on vendor_follower_counts to anon, authenticated;

-- User preferences: owner only
create policy "user_prefs_select" on user_preferences for select using (auth.uid() = user_id);
create policy "user_prefs_insert" on user_preferences for insert with check (auth.uid() = user_id);
create policy "user_prefs_update" on user_preferences for update using (auth.uid() = user_id);

-- Follow notifications: owner read, service role write (no insert policy for authenticated users)
create policy "follow_notifications_select" on follow_notifications for select using (auth.uid() = user_id);
