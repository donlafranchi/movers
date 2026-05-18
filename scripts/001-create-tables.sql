-- Main Street Market — Schema
-- Run in Supabase SQL Editor
-- This matches the app's TypeScript types exactly

-- Drop old tables if they exist (from previous incorrect schema)
drop table if exists reports cascade;
drop table if exists supports cascade;
drop table if exists businesses cascade;

-- Businesses
create table businesses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  name text not null,
  slug text not null unique,
  street_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  latitude double precision,
  longitude double precision,
  category text not null,
  ownership_tier text not null check (ownership_tier in (
    'independent', 'coop', 'local-franchise', 'challenger', 'mission-driven', 'pe-corporate'
  )),
  story text,
  parent_company text,
  location_count int,
  certification_type text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table businesses enable row level security;
create policy "Public read" on businesses for select using (true);
create policy "Auth insert" on businesses for insert to authenticated with check (auth.uid() = user_id);
create policy "Owner update" on businesses for update to authenticated using (auth.uid() = user_id);

-- Allow inserts without user_id (for seed data)
create policy "Anon insert" on businesses for insert with check (user_id is null);

create index idx_businesses_slug on businesses (slug);
create index idx_businesses_category on businesses (category);
create index idx_businesses_ownership on businesses (ownership_tier);
create index idx_businesses_lat on businesses (latitude);
create index idx_businesses_lng on businesses (longitude);

-- Supports
create table supports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  business_id uuid references businesses(id) not null,
  created_at timestamptz default now(),
  unique(user_id, business_id)
);

alter table supports enable row level security;
create policy "Public read" on supports for select using (true);
create policy "Auth insert" on supports for insert to authenticated with check (auth.uid() = user_id);
create policy "Auth delete" on supports for delete to authenticated using (auth.uid() = user_id);

create index idx_supports_business on supports (business_id);

-- Reports
create table reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  business_id uuid references businesses(id) not null,
  pillar text not null check (pillar in ('customers', 'employees', 'community', 'planet')),
  description text not null,
  source_url text,
  personal_witness boolean default false,
  created_at timestamptz default now()
);

alter table reports enable row level security;
create policy "Auth insert" on reports for insert to authenticated with check (auth.uid() = user_id);
