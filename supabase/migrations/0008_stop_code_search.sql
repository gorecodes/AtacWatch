-- ============================================================================
-- 0008_stop_code_search.sql — Ricerca fermate per numero/nome + espone il
-- codice fermata (stop_code) nelle funzioni che restituiscono fermate.
-- (DROP+CREATE dove cambia la firma.)
-- ============================================================================

-- Ricerca fermate per codice (numero palina) o nome
create or replace function search_stops(q text)
returns table (stop_id text, name text, code text, routes text[])
language sql stable as $$
  select s.stop_id, s.name, s.code,
         (select array_agg(distinct r.short_name order by r.short_name)
            from route_stops rs join routes r on r.route_id = rs.route_id
            where rs.stop_id = s.stop_id)
  from stops s
  where s.code = q
     or s.code ilike q || '%'
     or s.name ilike '%' || q || '%'
  order by (s.code = q) desc, (s.code ilike q || '%') desc, length(s.name), s.name
  limit 30;
$$;

-- Fermate vicine: aggiungo code
drop function if exists stops_nearby(double precision, double precision, double precision);
create function stops_nearby(p_lat double precision, p_lon double precision, p_radius_m double precision default 600)
returns table (stop_id text, name text, code text, lon double precision, lat double precision, distance_m int, routes text[])
language sql stable as $$
  with g as (select st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography as pt)
  select s.stop_id, s.name, s.code, st_x(s.geom), st_y(s.geom),
         st_distance(s.geom::geography, g.pt)::int as distance_m,
         (select array_agg(distinct r.short_name order by r.short_name)
            from route_stops rs
            join routes r on r.route_id = rs.route_id
            where rs.stop_id = s.stop_id)
  from stops s, g
  where st_dwithin(s.geom::geography, g.pt, p_radius_m)
  order by distance_m
  limit 40;
$$;

-- Fermate di una linea/verso: aggiungo code
drop function if exists route_stops_geo(text, int);
create function route_stops_geo(p_route_id text, p_direction_id int)
returns table (stop_id text, name text, code text, stop_sequence int, lon double precision, lat double precision)
language sql stable as $$
  select rs.stop_id, s.name, s.code, rs.stop_sequence, st_x(s.geom), st_y(s.geom)
  from route_stops rs
  join stops s using (stop_id)
  where rs.route_id = p_route_id and rs.direction_id = p_direction_id
  order by rs.stop_sequence;
$$;

-- Fermate di una corsa: aggiungo code
drop function if exists trip_stops(text);
create function trip_stops(p_trip_id text)
returns table (stop_id text, name text, code text, stop_sequence int,
               eta_ts timestamptz, delay int, lon double precision, lat double precision)
language sql stable as $$
  select tu.stop_id, s.name, s.code, tu.stop_sequence,
         coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts, tu.delay,
         st_x(s.geom), st_y(s.geom)
  from trip_updates tu
  join stops s on s.stop_id = tu.stop_id
  where tu.trip_id = p_trip_id
  order by tu.stop_sequence;
$$;
