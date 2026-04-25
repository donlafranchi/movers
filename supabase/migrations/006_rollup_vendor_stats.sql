-- 006_rollup_vendor_stats.sql
-- T026: nightly rollup of vendor_events into vendor_stats_daily.

create or replace function rollup_vendor_stats_daily(target_date date default (current_date - 1))
returns int
language plpgsql
security definer
as $$
declare
  inserted int := 0;
begin
  with event_rollup as (
    select
      vendor_id,
      count(*) filter (where event_name = 'profile_view') as profile_views,
      count(*) filter (where event_name = 'support_click') as support_clicks,
      count(*) filter (where event_name = 'follow') as new_follows,
      count(*) filter (where event_name = 'unfollow') as unfollows,
      count(*) filter (where event_name = 'share') as shares
    from vendor_events
    where created_at >= target_date::timestamptz
      and created_at <  (target_date + 1)::timestamptz
    group by vendor_id
  ),
  bulletin_rollup as (
    select vb.vendor_id, count(*)::int as bulletin_opens
    from bulletin_deliveries bd
    join vendor_bulletins vb on vb.id = bd.bulletin_id
    where bd.opened_at >= target_date::timestamptz
      and bd.opened_at <  (target_date + 1)::timestamptz
    group by vb.vendor_id
  ),
  merged as (
    select
      coalesce(e.vendor_id, b.vendor_id) as vendor_id,
      coalesce(e.profile_views, 0) as profile_views,
      coalesce(e.support_clicks, 0) as support_clicks,
      coalesce(e.new_follows, 0) as new_follows,
      coalesce(e.unfollows, 0) as unfollows,
      coalesce(e.shares, 0) as shares,
      coalesce(b.bulletin_opens, 0) as bulletin_opens
    from event_rollup e
    full outer join bulletin_rollup b using (vendor_id)
  )
  insert into vendor_stats_daily (vendor_id, day, profile_views, support_clicks, new_follows, unfollows, shares, bulletin_opens)
  select vendor_id, target_date, profile_views, support_clicks, new_follows, unfollows, shares, bulletin_opens
  from merged
  on conflict (vendor_id, day) do update set
    profile_views = excluded.profile_views,
    support_clicks = excluded.support_clicks,
    new_follows = excluded.new_follows,
    unfollows = excluded.unfollows,
    shares = excluded.shares,
    bulletin_opens = excluded.bulletin_opens;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

grant execute on function rollup_vendor_stats_daily(date) to anon, authenticated;
