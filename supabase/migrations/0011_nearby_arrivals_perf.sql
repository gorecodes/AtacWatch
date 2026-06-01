-- ============================================================================
-- 0011_nearby_arrivals_perf.sql
-- Performance fix per nearby_arrivals:
--
-- Problema: scheduled_src eseguiva unnest(ss.departures) su TUTTE le righe
-- stop_schedule nel raggio, poi filtrava. Con 70+ fermate × 25 route/service
-- × 100+ partenze/array = ~175k righe esplose prima del WHERE.
--
-- Fix:
--   1. nearby AS MATERIALIZED LIMIT 30: processa solo le 30 fermate più vicine
--      invece di tutte le 80+ nel raggio. È il fix principale: riduce il lavoro
--      su stop_schedule × unnest di ~3-4x.
--   2. sched_today/sched_yday AS MATERIALIZED: pre-filtra le righe stop_schedule
--      con array bounds check prima di unnest, poi unnesta solo le righe utili.
--   3. Indice composito (stop_id, service_id) su stop_schedule.
-- ============================================================================

create index if not exists stop_schedule_stop_service_idx
  on stop_schedule (stop_id, service_id);

create or replace function nearby_arrivals(
  p_lat        double precision,
  p_lon        double precision,
  p_radius_m   double precision default 700,
  p_horizon_min int             default 25
)
returns table (
  route_id    text,
  short_name  text,
  headsign    text,
  direction_id smallint,
  eta_ts      timestamptz,
  minutes     int,
  is_realtime boolean,
  delay       int,
  stop_id     text,
  stop_name   text,
  stop_code   text,
  distance_m  int
)
language sql stable set search_path = public as $$
  with
  geo as (
    select st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography as pt
  ),
  -- Limita alle 30 fermate più vicine (KNN + LIMIT).
  -- Senza questo, in centro Roma il raggio 700m restituisce 80+ fermate
  -- e stop_schedule × unnest esplode. Con MATERIALIZED viene calcolato
  -- una sola volta e riusato da tutti i CTE successivi.
  nearby as materialized (
    select s.stop_id, s.name as stop_name, s.code as stop_code,
           st_distance(s.geom::geography, geo.pt)::int as distance_m
    from stops s, geo
    where st_dwithin(s.geom::geography, geo.pt, p_radius_m)
    order by s.geom <-> geo.pt::geometry
    limit 30
  ),
  p as (
    select lt as local_ts, lt::date as today, (lt::date - 1) as yday,
           extract(epoch from (lt - date_trunc('day', lt)))::int as now_seconds
    from (select (now() at time zone 'Europe/Rome') as lt) x
  ),
  act_today as (select service_id from active_services((select today from p))),
  act_yday  as (select service_id from active_services((select yday  from p))),
  realtime as (
    select n.stop_id, n.stop_name, n.stop_code, n.distance_m,
           tu.route_id, tu.trip_id,
           coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts,
           tu.delay,
           coalesce(vp.direction_id, st.direction_id)::smallint as direction_id
    from nearby n
    join trip_updates tu on tu.stop_id = n.stop_id
    left join vehicle_positions vp on vp.trip_id = tu.trip_id
    left join stg_trips st on st.trip_id = tu.trip_id
    where coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
      and tu.updated_at > now() - interval '5 minutes'
      and coalesce(tu.arrival_ts, tu.departure_ts)
            <= now() + (p_horizon_min || ' minutes')::interval
  ),
  realtime_rows as (
    select rt.route_id, r.short_name, rsh.headsign, rt.direction_id, rt.trip_id, rt.eta_ts,
           greatest(0, floor(extract(epoch from (rt.eta_ts - now())) / 60))::int as minutes,
           true as is_realtime, rt.delay,
           rt.stop_id, rt.stop_name, rt.stop_code, rt.distance_m
    from realtime rt
    join routes r on r.route_id = rt.route_id
    left join lateral (
      select rs.headsign from route_stops rs
      where rs.route_id = rt.route_id and rs.stop_id = rt.stop_id
        and (rt.direction_id is null or rs.direction_id = rt.direction_id)
      limit 1
    ) rsh on true
  ),
  -- Righe di stop_schedule pre-filtrate prima dell'unnest.
  -- MATERIALIZED garantisce che il filtro sull'array venga eseguito PRIMA
  -- che la CTE successiva chiami unnest, riducendo drasticamente il lavoro.
  -- Condizione: almeno una partenza potrebbe cadere nella finestra temporale.
  -- (departures è ordinato ASC → [1] = min, [last] = max)
  sched_today as materialized (
    select n.stop_id, n.stop_name, n.stop_code, n.distance_m,
           ss.route_id, ss.headsign, ss.direction_id,
           p.today::timestamp as base_date,
           ss.departures,
           p.now_seconds
    from nearby n
    join stop_schedule ss on ss.stop_id = n.stop_id
    join act_today a on a.service_id = ss.service_id
    cross join p
    where ss.departures[array_upper(ss.departures, 1)] >= p.now_seconds
      and ss.departures[1] <= p.now_seconds + p_horizon_min * 60
  ),
  sched_yday as materialized (
    select n.stop_id, n.stop_name, n.stop_code, n.distance_m,
           ss.route_id, ss.headsign, ss.direction_id,
           p.yday::timestamp as base_date,
           ss.departures,
           p.now_seconds
    from nearby n
    join stop_schedule ss on ss.stop_id = n.stop_id
    join act_yday a on a.service_id = ss.service_id
    cross join p
    where ss.departures[array_upper(ss.departures, 1)] >= p.now_seconds + 86400
      and ss.departures[1] <= p.now_seconds + 86400 + p_horizon_min * 60
  ),
  scheduled_src as (
    select sc.stop_id, sc.stop_name, sc.stop_code, sc.distance_m,
           sc.route_id, sc.headsign, sc.direction_id,
           sc.base_date, dep,
           (dep - sc.now_seconds) as secs_ahead
    from sched_today sc
    cross join lateral unnest(sc.departures) as dep
    where dep >= sc.now_seconds
      and dep <= sc.now_seconds + p_horizon_min * 60
    union all
    select sc.stop_id, sc.stop_name, sc.stop_code, sc.distance_m,
           sc.route_id, sc.headsign, sc.direction_id,
           sc.base_date, dep,
           (dep - 86400 - sc.now_seconds)
    from sched_yday sc
    cross join lateral unnest(sc.departures) as dep
    where dep >= sc.now_seconds + 86400
      and dep <= sc.now_seconds + 86400 + p_horizon_min * 60
  ),
  scheduled_rows as (
    select sc.route_id, r.short_name, sc.headsign, sc.direction_id,
           null::text as trip_id,
           ((sc.base_date + (sc.dep * interval '1 second')) at time zone 'Europe/Rome') as eta_ts,
           (sc.secs_ahead / 60)::int as minutes,
           false as is_realtime, null::int as delay,
           sc.stop_id, sc.stop_name, sc.stop_code, sc.distance_m
    from scheduled_src sc
    join routes r on r.route_id = sc.route_id
  ),
  merged as (
    select * from realtime_rows
    union all
    select * from scheduled_rows sc
    where not exists (
      select 1 from realtime_rows rr
      where rr.route_id = sc.route_id
        and rr.stop_id = sc.stop_id
        and (
          coalesce(rr.direction_id, -1) = coalesce(sc.direction_id, -1)
          or rr.direction_id is null
        )
        and abs(extract(epoch from (rr.eta_ts - sc.eta_ts))) < 300
    )
  ),
  deduped as (
    select distinct on (route_id, coalesce(direction_id, -1))
           route_id, short_name, headsign, direction_id, eta_ts, minutes,
           is_realtime, delay, stop_id, stop_name, stop_code, distance_m
    from merged
    order by route_id, coalesce(direction_id, -1), distance_m asc, minutes asc
  )
  select route_id, short_name, headsign, direction_id, eta_ts, minutes,
         is_realtime, delay, stop_id, stop_name, stop_code, distance_m
  from deduped
  order by distance_m asc, minutes asc
  limit 25;
$$;
