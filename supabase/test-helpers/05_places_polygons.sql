-- T059 — Eval helper: inject / clear synthetic polygons on seeded places.
--
-- The b1 places seed (017_places.sql) ships rows without geometry — the
-- polygon library is a T2 deliverable per places.md § Data model
-- implications. T059's reverse-geocoder eval needs to *test* containment
-- semantics, so this helper lets the eval inject a synthetic polygon onto
-- a seeded row by (slug, kind), then clear it at teardown.
--
-- ADR-0022 brought ambiguous-by-slug rows into the seed (Sacramento exists
-- as both a county and a city), so the helper requires kind to
-- disambiguate. The eval passes kind explicitly per call.
--
-- Why a helper rather than direct UPDATE: T051 action-layer conformance
-- bans direct writes to public.places from anywhere except the action
-- layer. This file is allowlisted (see scripts/check-action-layer-
-- conformance.ts ALLOWED_EXCEPTIONS), keeping the rule sharp everywhere
-- else.

create or replace function public.eval_set_place_polygon(
  p_slug text,
  p_kind text,
  p_wkt  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_wkt is null then
    update public.places
       set geography = null
     where slug = p_slug and kind = p_kind;
  else
    update public.places
       set geography = ST_GeogFromText('SRID=4326;' || p_wkt)
     where slug = p_slug and kind = p_kind;
  end if;
end;
$$;

revoke execute on function public.eval_set_place_polygon(text, text, text) from public;
grant execute on function public.eval_set_place_polygon(text, text, text) to service_role;

-- Drop the older single-(slug,wkt) signature so callers that forget to
-- pass kind fail loudly instead of silently updating the wrong row.
drop function if exists public.eval_set_place_polygon(text, text);

comment on function public.eval_set_place_polygon(text, text, text) is
  'Phase 1 eval helper for T059 — injects a synthetic MultiPolygon WKT onto a seeded place by (slug, kind), or clears it when p_wkt is null. Service-role only. Allowed direct write to public.places for the polygon-containment evals. The kind argument disambiguates collisions (e.g., Sacramento city vs county) introduced by ADR-0022.';
