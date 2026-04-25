-- 005_bulletin_mutes.sql
-- T025: per-user mute of a vendor's bulletins (in-app only; email opt-out is via
-- bulletin_deliveries.unsubscribed_at).

create table if not exists bulletin_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vendor_id)
);

create index if not exists idx_bulletin_mutes_user on bulletin_mutes (user_id);

alter table bulletin_mutes enable row level security;
create policy "bulletin_mutes_select_self" on bulletin_mutes for select
  using (auth.uid() = user_id);
create policy "bulletin_mutes_insert_self" on bulletin_mutes for insert
  with check (auth.uid() = user_id);
create policy "bulletin_mutes_delete_self" on bulletin_mutes for delete
  using (auth.uid() = user_id);
