-- ============================================================================
-- 0013_realtime_headsign.sql — Testata e verso ESATTI per gli arrivi realtime.
--
-- Contesto: i trip_id del feed GTFS-RT di Roma combaciano 1:1 con quelli del
-- GTFS statico (verificato), e portano il direction_id corretto. Finora però la
-- testata (headsign) del realtime veniva pescata da route_stops, che contiene
-- solo le fermate del TRIP RAPPRESENTATIVO di ogni verso. Conseguenze:
--   - se la fermata non è in quel trip → nessuna riga → testata NULL (trattino);
--   - su versi con più capolinea, mostrava la testata del rappresentativo invece
--     di quella reale → la lista non coincideva con la corsa aperta col click.
--
-- Fix: tabella `trips` persistente (trip_id → route_id, direction_id, headsign),
-- popolata dall'ETL. Gli RPC prendono testata+verso del realtime via join su
-- trip_updates.trip_id → trips. Fallback su route_stops (preferendo il verso,
-- altrimenti qualunque) finché l'ETL non ha popolato `trips`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabella trips (una riga per corsa). Piccola: ~177k righe di sole colonne corte.
-- ----------------------------------------------------------------------------
create table if not exists trips (
  trip_id      text primary key,
  route_id     text,
  direction_id smallint,
  headsign     text
);
create index if not exists trips_route_dir_idx on trips (route_id, direction_id);

alter table trips enable row level security;
drop policy if exists trips_read on trips;
create policy trips_read on trips for select using (true);

-- ----------------------------------------------------------------------------
-- ETL: popola `trips` dalle staging PRIMA del truncate. Aggiunge solo questo
-- blocco; il resto di rebuild_static_from_staging resta invariato (0002).
-- ----------------------------------------------------------------------------
create or replace function rebuild_static_from_staging() returns void
language plpgsql as $$
begin
  -- routes
  truncate routes;
  insert into routes (route_id, agency_id, short_name, long_name, type, color, text_color)
  select route_id, agency_id,
         coalesce(nullif(route_short_name, ''), route_long_name, route_id),
         route_long_name, coalesce(route_type, 3), route_color, route_text_color
  from stg_routes;

  -- stops
  truncate stops;
  insert into stops (stop_id, code, name, geom)
  select stop_id, stop_code, coalesce(nullif(stop_name, ''), stop_id),
         st_setsrid(st_makepoint(stop_lon, stop_lat), 4326)
  from stg_stops
  where stop_lat is not null and stop_lon is not null;

  -- calendar
  truncate calendar;
  insert into calendar
  select service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
         start_date, end_date
  from stg_calendar;

  truncate calendar_dates;
  insert into calendar_dates
  select service_id, date, exception_type from stg_calendar_dates;

  -- trips: una riga per corsa (verso + testata esatti, joinabili dal realtime)
  truncate trips;
  insert into trips (trip_id, route_id, direction_id, headsign)
  select trip_id, route_id, coalesce(direction_id, 0), nullif(trip_headsign, '')
  from stg_trips;

  -- stop_schedule (OPZIONE C: orari compressi in array per servizio)
  truncate stop_schedule;
  insert into stop_schedule (stop_id, route_id, direction_id, service_id, headsign, departures)
  select st.stop_id, t.route_id, coalesce(t.direction_id, 0), t.service_id,
         mode() within group (order by t.trip_headsign),
         array_agg(st.departure_s order by st.departure_s)
  from stg_stop_times st
  join stg_trips t on t.trip_id = st.trip_id
  where st.departure_s is not null
  group by st.stop_id, t.route_id, coalesce(t.direction_id, 0), t.service_id;

  -- trip rappresentativo per (route, direction): quello con più fermate
  drop table if exists _rep_trips;
  create temp table _rep_trips as
  with trip_len as (
    select t.trip_id, t.route_id, coalesce(t.direction_id, 0) as direction_id,
           t.trip_headsign, t.shape_id, count(*) as n
    from stg_trips t
    join stg_stop_times st on st.trip_id = t.trip_id
    group by t.trip_id, t.route_id, coalesce(t.direction_id, 0), t.trip_headsign, t.shape_id
  )
  select distinct on (route_id, direction_id)
         trip_id, route_id, direction_id, trip_headsign, shape_id
  from trip_len
  order by route_id, direction_id, n desc;

  -- route_stops (elenco ordinato fermate del trip rappresentativo)
  truncate route_stops;
  insert into route_stops (route_id, direction_id, stop_sequence, stop_id, headsign)
  select r.route_id, r.direction_id, st.stop_sequence, st.stop_id, r.trip_headsign
  from _rep_trips r
  join stg_stop_times st on st.trip_id = r.trip_id;

  -- route_shapes (polilinea del trip rappresentativo)
  truncate route_shapes;
  insert into route_shapes (route_id, direction_id, geom)
  select r.route_id, r.direction_id,
         st_makeline(st_setsrid(st_makepoint(s.lon, s.lat), 4326) order by s.seq)
  from _rep_trips r
  join stg_shapes s on s.shape_id = r.shape_id
  where r.shape_id is not null
  group by r.route_id, r.direction_id
  having count(*) >= 2;

  -- pulizia staging (non pesa sul free tier a regime)
  truncate stg_routes, stg_stops, stg_trips, stg_stop_times, stg_shapes,
           stg_calendar, stg_calendar_dates;
end $$;

-- ----------------------------------------------------------------------------
-- stop_arrivals: testata+verso del realtime da `trips` (fallback route_stops).
-- ----------------------------------------------------------------------------
create or replace function stop_arrivals(p_stop_id text)
returns table (route_id text, short_name text, headsign text, direction_id smallint,
               trip_id text, eta_ts timestamptz, minutes int, is_realtime boolean, delay int)
language sql stable set search_path = public as $$
  with p as (
    select lt as local_ts, lt::date as today, (lt::date - 1) as yday,
           extract(epoch from (lt - date_trunc('day', lt)))::int as now_seconds
    from (select (now() at time zone 'Europe/Rome') as lt) x
  ),
  act_today as (select service_id from active_services((select today from p))),
  act_yday  as (select service_id from active_services((select yday  from p))),
  realtime as (
    select tu.route_id, tu.trip_id,
           coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts,
           tu.delay,
           coalesce(tr.direction_id, tu.direction_id, vp.direction_id)::smallint as direction_id,
           tr.headsign as trip_headsign
    from trip_updates tu
    left join trips tr on tr.trip_id = tu.trip_id
    left join vehicle_positions vp on vp.trip_id = tu.trip_id
    where tu.stop_id = p_stop_id
      and coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
      and tu.updated_at > now() - interval '5 minutes'
  ),
  realtime_rows as (
    select rt.route_id, r.short_name,
           coalesce(rt.trip_headsign, rsh.headsign) as headsign,
           rt.direction_id, rt.trip_id, rt.eta_ts,
           greatest(0, floor(extract(epoch from (rt.eta_ts - now())) / 60))::int as minutes,
           true as is_realtime, rt.delay
    from realtime rt
    join routes r on r.route_id = rt.route_id
    left join lateral (
      select rs.headsign from route_stops rs
      where rs.route_id = rt.route_id and rs.stop_id = p_stop_id
      order by (rs.direction_id = rt.direction_id) desc nulls last
      limit 1
    ) rsh on true
  ),
  scheduled_src as (
    select ss.route_id, ss.headsign, ss.direction_id,
           p.today::timestamp as base_date, dep, (dep - p.now_seconds) as secs_ahead
    from stop_schedule ss
    join act_today a on a.service_id = ss.service_id
    cross join p
    cross join lateral unnest(ss.departures) as dep
    where ss.stop_id = p_stop_id
      and dep >= p.now_seconds and dep <= p.now_seconds + 5400
    union all
    select ss.route_id, ss.headsign, ss.direction_id,
           p.yday::timestamp, dep, (dep - 86400 - p.now_seconds)
    from stop_schedule ss
    join act_yday a on a.service_id = ss.service_id
    cross join p
    cross join lateral unnest(ss.departures) as dep
    where ss.stop_id = p_stop_id
      and dep >= p.now_seconds + 86400 and dep <= p.now_seconds + 86400 + 5400
  ),
  scheduled_rows as (
    select sc.route_id, r.short_name, sc.headsign, sc.direction_id, null::text as trip_id,
           ((sc.base_date + (sc.dep * interval '1 second')) at time zone 'Europe/Rome') as eta_ts,
           (sc.secs_ahead / 60)::int as minutes,
           false as is_realtime, null::int as delay
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
        and coalesce(rr.direction_id, -1) = coalesce(sc.direction_id, -1)
        and abs(extract(epoch from (
              (rr.eta_ts - make_interval(secs => coalesce(rr.delay, 0))) - sc.eta_ts
            ))) < 300
    )
  )
  select * from merged
  order by minutes asc, is_realtime desc
  limit 25;
$$;

-- ----------------------------------------------------------------------------
-- route_stop_arrivals: testata del realtime da `trips` (fallback route_stops).
-- ----------------------------------------------------------------------------
create or replace function route_stop_arrivals(p_route_id text, p_stop_id text)
returns table (trip_id text, headsign text, eta_ts timestamptz,
               minutes int, is_realtime boolean, delay int)
language sql stable set search_path = public as $$
  with p as (
    select lt as local_ts, lt::date as today, (lt::date - 1) as yday,
           extract(epoch from (lt - date_trunc('day', lt)))::int as now_seconds
    from (select (now() at time zone 'Europe/Rome') as lt) x
  ),
  act_today as (select service_id from active_services((select today from p))),
  act_yday  as (select service_id from active_services((select yday  from p))),
  realtime_rows as (
    select tu.trip_id,
           coalesce(
             (select tr.headsign from trips tr where tr.trip_id = tu.trip_id),
             (select rs.headsign from route_stops rs
              where rs.route_id = p_route_id and rs.stop_id = p_stop_id limit 1)
           ) as headsign,
           coalesce(tu.arrival_ts, tu.departure_ts) as eta_ts,
           greatest(0, floor(extract(epoch from (coalesce(tu.arrival_ts, tu.departure_ts) - now())) / 60))::int as minutes,
           true as is_realtime, tu.delay
    from trip_updates tu
    where tu.stop_id = p_stop_id and tu.route_id = p_route_id
      and coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
      and tu.updated_at > now() - interval '5 minutes'
  ),
  scheduled_src as (
    select ss.headsign, p.today::timestamp as base_date, dep, (dep - p.now_seconds) as secs_ahead
    from stop_schedule ss
    join act_today a on a.service_id = ss.service_id
    cross join p
    cross join lateral unnest(ss.departures) as dep
    where ss.stop_id = p_stop_id and ss.route_id = p_route_id
      and dep >= p.now_seconds and dep <= p.now_seconds + 7200
    union all
    select ss.headsign, p.yday::timestamp, dep, (dep - 86400 - p.now_seconds)
    from stop_schedule ss
    join act_yday a on a.service_id = ss.service_id
    cross join p
    cross join lateral unnest(ss.departures) as dep
    where ss.stop_id = p_stop_id and ss.route_id = p_route_id
      and dep >= p.now_seconds + 86400 and dep <= p.now_seconds + 86400 + 7200
  ),
  scheduled_rows as (
    select null::text as trip_id, sc.headsign,
           ((sc.base_date + (sc.dep * interval '1 second')) at time zone 'Europe/Rome') as eta_ts,
           (sc.secs_ahead / 60)::int as minutes,
           false as is_realtime, null::int as delay
    from scheduled_src sc
  )
  select * from (
    select * from realtime_rows
    union all
    select * from scheduled_rows sc
    where not exists (
      select 1 from realtime_rows rr
      where abs(extract(epoch from (
              (rr.eta_ts - make_interval(secs => coalesce(rr.delay, 0))) - sc.eta_ts
            ))) < 300
    )
  ) m
  order by minutes asc, is_realtime desc
  limit 5;
$$;

-- ----------------------------------------------------------------------------
-- nearby_arrivals: testata+verso del realtime da `trips` (fallback route_stops).
-- Mantiene le ottimizzazioni di 0011 (nearby LIMIT 30 + sched_* MATERIALIZED).
-- ----------------------------------------------------------------------------
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
           coalesce(tr.direction_id, tu.direction_id, vp.direction_id)::smallint as direction_id,
           tr.headsign as trip_headsign
    from nearby n
    join trip_updates tu on tu.stop_id = n.stop_id
    left join trips tr on tr.trip_id = tu.trip_id
    left join vehicle_positions vp on vp.trip_id = tu.trip_id
    where coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
      and tu.updated_at > now() - interval '5 minutes'
      and coalesce(tu.arrival_ts, tu.departure_ts)
            <= now() + (p_horizon_min || ' minutes')::interval
  ),
  realtime_rows as (
    select rt.route_id, r.short_name,
           coalesce(rt.trip_headsign, rsh.headsign) as headsign,
           rt.direction_id, rt.trip_id, rt.eta_ts,
           greatest(0, floor(extract(epoch from (rt.eta_ts - now())) / 60))::int as minutes,
           true as is_realtime, rt.delay,
           rt.stop_id, rt.stop_name, rt.stop_code, rt.distance_m
    from realtime rt
    join routes r on r.route_id = rt.route_id
    left join lateral (
      select rs.headsign from route_stops rs
      where rs.route_id = rt.route_id and rs.stop_id = rt.stop_id
      order by (rs.direction_id = rt.direction_id) desc nulls last
      limit 1
    ) rsh on true
  ),
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
        and abs(extract(epoch from (
              (rr.eta_ts - make_interval(secs => coalesce(rr.delay, 0))) - sc.eta_ts
            ))) < 300
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
