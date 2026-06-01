-- ============================================================================
-- 0003_rpc.sql — Funzioni di lettura chiamate dall'app (PostgREST .rpc()).
-- security invoker: girano come 'anon', le policy RLS (select true) consentono.
-- ============================================================================

-- Ricerca linee per numero/nome
create or replace function search_routes(q text)
returns setof routes language sql stable as $$
  select * from routes
  where short_name ilike q || '%'
     or short_name ilike '%' || q || '%'
     or long_name  ilike '%' || q || '%'
  order by (short_name ilike q || '%') desc, length(short_name), short_name
  limit 50;
$$;

-- Versi disponibili di una linea (con capolinea)
create or replace function route_directions(p_route_id text)
returns table (direction_id smallint, headsign text)
language sql stable as $$
  select distinct direction_id, headsign
  from route_stops
  where route_id = p_route_id
  order by direction_id;
$$;

-- Fermate ordinate di una linea per verso
create or replace function route_stops_geo(p_route_id text, p_direction_id int)
returns table (stop_id text, name text, stop_sequence int, lon double precision, lat double precision)
language sql stable as $$
  select rs.stop_id, s.name, rs.stop_sequence, st_x(s.geom), st_y(s.geom)
  from route_stops rs
  join stops s using (stop_id)
  where rs.route_id = p_route_id and rs.direction_id = p_direction_id
  order by rs.stop_sequence;
$$;

-- Tracciato della linea come GeoJSON (LineString)
create or replace function route_shape_geojson(p_route_id text, p_direction_id int)
returns text language sql stable as $$
  select st_asgeojson(geom)
  from route_shapes
  where route_id = p_route_id and direction_id = p_direction_id;
$$;

-- Fermate vicine a una coordinata (default 600 m)
create or replace function stops_nearby(p_lat double precision, p_lon double precision, p_radius_m double precision default 600)
returns table (stop_id text, name text, lon double precision, lat double precision, distance_m int, routes text[])
language sql stable as $$
  with g as (select st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography as pt)
  select s.stop_id, s.name, st_x(s.geom), st_y(s.geom),
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

-- Mezzi nel riquadro visibile della mappa
create or replace function vehicles_in_bbox(
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision)
returns table (vehicle_id text, route_id text, short_name text, type smallint,
               lon double precision, lat double precision, bearing real, ts timestamptz)
language sql stable as $$
  select v.vehicle_id, v.route_id, r.short_name, r.type, v.lon, v.lat, v.bearing, v.ts
  from vehicle_positions v
  left join routes r on r.route_id = v.route_id
  where v.geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    and v.ts > now() - interval '5 minutes'
  limit 1500;
$$;

-- Arrivi a una fermata: realtime (trip_updates) + fallback orario programmato.
create or replace function stop_arrivals(p_stop_id text)
returns table (route_id text, short_name text, headsign text, direction_id smallint,
               eta_ts timestamptz, minutes int, is_realtime boolean, delay int)
language sql stable as $$
  with p as (
    select lt as local_ts, lt::date as today,
           extract(epoch from (lt - date_trunc('day', lt)))::int as now_seconds
    from (select (now() at time zone 'Europe/Rome') as lt) x
  ),
  active as (
    select c.service_id from calendar c, p
    where c.start_date <= p.today and c.end_date >= p.today
      and case extract(dow from p.today)
            when 0 then c.sunday when 1 then c.monday when 2 then c.tuesday
            when 3 then c.wednesday when 4 then c.thursday when 5 then c.friday
            when 6 then c.saturday end
    union
    select cd.service_id from calendar_dates cd, p where cd.date = p.today and cd.exception_type = 1
    except
    select cd.service_id from calendar_dates cd, p where cd.date = p.today and cd.exception_type = 2
  ),
  realtime as (
    select tu.route_id,
           coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts,
           tu.delay, vp.direction_id::smallint as direction_id
    from trip_updates tu
    left join vehicle_positions vp on vp.trip_id = tu.trip_id
    where tu.stop_id = p_stop_id
      and coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
      and tu.updated_at > now() - interval '5 minutes'
  ),
  realtime_rows as (
    select rt.route_id, r.short_name, rsh.headsign, rt.direction_id, rt.eta_ts,
           greatest(0, floor(extract(epoch from (rt.eta_ts - now())) / 60))::int as minutes,
           true as is_realtime, rt.delay
    from realtime rt
    join routes r on r.route_id = rt.route_id
    left join lateral (
      select rs.headsign from route_stops rs
      where rs.route_id = rt.route_id and rs.stop_id = p_stop_id
        and (rt.direction_id is null or rs.direction_id = rt.direction_id)
      limit 1
    ) rsh on true
  ),
  scheduled_rows as (
    select ss.route_id, r.short_name, ss.headsign, ss.direction_id,
           ((p.today::timestamp + (dep * interval '1 second')) at time zone 'Europe/Rome') as eta_ts,
           ((dep - p.now_seconds) / 60)::int as minutes,
           false as is_realtime, null::int as delay
    from stop_schedule ss
    join active a on a.service_id = ss.service_id
    join routes r on r.route_id = ss.route_id
    cross join p
    cross join lateral unnest(ss.departures) as dep
    where ss.stop_id = p_stop_id
      and dep >= p.now_seconds and dep <= p.now_seconds + 5400
  ),
  merged as (
    select * from realtime_rows
    union all
    select * from scheduled_rows sc
    where not exists (
      select 1 from realtime_rows rr
      where rr.route_id = sc.route_id
        and coalesce(rr.direction_id, -1) = coalesce(sc.direction_id, -1)
    )
  )
  select * from merged
  order by minutes asc, is_realtime desc
  limit 25;
$$;
