-- 001_initial_schema.sql
-- Main Street Market b1 MVP schema

-- Businesses
create table businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  slug text unique not null,
  street_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  latitude numeric,
  longitude numeric,
  category text not null,
  ownership_tier text not null,
  story text,
  parent_company text,
  location_count integer,
  certification_type text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_businesses_location on businesses (latitude, longitude);
create index idx_businesses_category on businesses (category);
create index idx_businesses_slug on businesses (slug);

-- Supports (hearts)
create table supports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, business_id)
);

create index idx_supports_business on supports (business_id);

-- Reports (community accountability)
create table reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  pillar text not null,
  description text not null,
  source_url text,
  personal_witness boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_reports_business on reports (business_id);

-- Row Level Security
alter table businesses enable row level security;
alter table supports enable row level security;
alter table reports enable row level security;

-- Businesses: anyone can read, owner can update
create policy "businesses_select" on businesses for select using (true);
create policy "businesses_insert" on businesses for insert with check (auth.uid() = user_id);
create policy "businesses_update" on businesses for update using (auth.uid() = user_id);

-- Supports: anyone can read, authenticated users manage own
create policy "supports_select" on supports for select using (true);
create policy "supports_insert" on supports for insert with check (auth.uid() = user_id);
create policy "supports_delete" on supports for delete using (auth.uid() = user_id);

-- Reports: authenticated users can insert own, only service role can read
create policy "reports_insert" on reports for insert with check (auth.uid() = user_id);

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger businesses_updated_at
  before update on businesses
  for each row execute function update_updated_at();
