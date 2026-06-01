-- ============================================================================
-- 0006_trip_detail.sql — Vista del singolo mezzo/corsa.
-- Espone trip_id su mappa e arrivi, e aggiunge le fermate previste della corsa.
-- (DROP+CREATE perché cambia la firma di funzioni esistenti.)
-- ============================================================================

-- 1) Mezzi nel bbox: aggiungo trip_id (per navigare alla corsa)
drop function if exists vehicles_in_bbox(double precision, double precision, double precision, double precision);
create function vehicles_in_bbox(
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision)
returns table (vehicle_id text, route_id text, short_name text, type smallint,
               trip_id text, lon double precision, lat double precision,
               bearing real, ts timestamptz)
language sql stable as $$
  select v.vehicle_id, v.route_id, r.short_name, r.type, v.trip_id,
         v.lon, v.lat, v.bearing, v.ts
  from vehicle_positions v
  left join routes r on r.route_id = v.route_id
  where v.geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    and v.ts > now() - interval '5 minutes'
  limit 1500;
$$;

-- 2) Arrivi alla fermata: aggiungo trip_id (null per i soli orari programmati)
drop function if exists stop_arrivals(text);
create function stop_arrivals(p_stop_id text)
returns table (route_id text, short_name text, headsign text, direction_id smallint,
               trip_id text, eta_ts timestamptz, minutes int, is_realtime boolean, delay int)
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
    select tu.route_id, tu.trip_id,
           coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts,
           tu.delay, vp.direction_id::smallint as direction_id
    from trip_updates tu
    left join vehicle_positions vp on vp.trip_id = tu.trip_id
    where tu.stop_id = p_stop_id
      and coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
      and tu.updated_at > now() - interval '5 minutes'
  ),
  realtime_rows as (
    select rt.route_id, r.short_name, rsh.headsign, rt.direction_id, rt.trip_id, rt.eta_ts,
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
    select ss.route_id, r.short_name, ss.headsign, ss.direction_id, null::text as trip_id,
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

-- 3) Fermate previste di una corsa (dai trip_updates: solo quelle future)
create or replace function trip_stops(p_trip_id text)
returns table (stop_id text, name text, stop_sequence int,
               eta_ts timestamptz, delay int, lon double precision, lat double precision)
language sql stable as $$
  select tu.stop_id, s.name, tu.stop_sequence,
         coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts, tu.delay,
         st_x(s.geom), st_y(s.geom)
  from trip_updates tu
  join stops s on s.stop_id = tu.stop_id
  where tu.trip_id = p_trip_id
  order by tu.stop_sequence;
$$;
