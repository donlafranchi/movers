-- T104 — Venue distance helper (F033 venue-page header).
--
-- Spec:   planning/next/scenario-F033-viewer-finds-venue-page.md
--         (AC "Distance displays from the viewer's primary home Place centroid")
-- Ticket: development/tickets/T104-venue-page-shell.md
--
-- Returns the great-circle distance (metres) from the *viewer's* primary-home
-- Place centroid to a venue Location. There is no PostgREST-readable lat/lng on
-- either geography column, and no existing distance utility (the F030 locality
-- feed keys off polygon containment, not distance), so the header needs this
-- one read-only function. DEVIATION recorded: T104 ticket asserted "no new
-- migrations needed"; this minimal helper is required to satisfy the
-- distance-from-primary-home AC.
--
-- security invoker: the function runs as the caller, so member_place_interests
-- owner-only RLS (migration 018) lets an auth'd Member read their OWN
-- primary_home and nobody else's. An anonymous caller (auth.uid() IS NULL)
-- matches no row and gets NULL — the header then omits the distance line. places
-- and locations are anon-readable (017/007), so no elevated rights are needed.

create or replace function public.venue_distance_meters(p_location_id uuid)
returns double precision
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select st_distance(p.centroid, l.geography)
  from public.member_place_interests mpi
  join public.places p
    on p.id = mpi.place_id
   and p.deleted_at is null
   and p.centroid is not null
  join public.locations l
    on l.id = p_location_id
   and l.deleted_at is null
  where mpi.member_id = auth.uid()
    and mpi.scope_kind = 'primary_home'
    and mpi.removed_at is null
  limit 1;
$$;

revoke all on function public.venue_distance_meters(uuid) from public;
grant execute on function public.venue_distance_meters(uuid) to anon, authenticated;

comment on function public.venue_distance_meters(uuid) is
  'F033 venue-page header: metres from the calling Member''s primary_home Place centroid to a venue Location. security invoker so member_place_interests owner-RLS scopes it to the caller; anon → NULL (distance line omitted).';
