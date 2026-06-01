-- ============================================================================
-- 0012_arrivals_correctness.sql — Correttezza degli arrivi.
--
-- Fix:
--   #1 direction_id del realtime: il feed GTFS-RT di Roma fornisce
--      trip.direction_id su OGNI trip update, ma finora veniva scartato e la
--      colonna non esisteva. Il fallback in nearby_arrivals leggeva da
--      stg_trips, che però viene TRUNCATE-ato a fine ETL (sempre vuoto), e la
--      direzione finiva quasi sempre a NULL. Conseguenze visibili:
--        - stop_arrivals: lo stesso bus compariva DUE volte (realtime con
--          direzione NULL + programmato con direzione reale → dedup falliva);
--        - nearby_arrivals: la clausola "or rr.direction_id is null" sopprimeva
--          i programmati dell'altra direzione → arrivi mancanti.
--      Ora: colonna direction_id su trip_updates, popolata dall'ingest, usata
--      dagli RPC; rimosso il join morto a stg_trips.
--
--   #2 doppio conteggio per ritardi > 5 min: la dedup realtime↔programmato
--      confrontava l'eta realtime (già ritardata) con lo slot programmato, con
--      finestra ±5 min. Un bus con oltre 5 min di ritardo sfuggiva alla dedup e
--      compariva due volte. stop_schedule non ha trip_id per un match esatto, ma
--      il feed dà il `delay`: l'orario PROGRAMMATO del trip realtime è
--      (eta - delay). Confrontiamo QUELLO con lo slot programmato → robusto a
--      qualunque entità di ritardo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- #1 colonna direction_id sul realtime + RPC di swap aggiornata.
-- ----------------------------------------------------------------------------
alter table trip_updates add column if not exists direction_id smallint;

create or replace function replace_trip_updates(p_rows jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('replace_trip_updates'));
  -- `where true`: lo swap svuota di proposito tutta la tabella, ma l'estensione
  -- safeupdate blocca i DELETE senza WHERE. La clausola la soddisfa senza
  -- cambiare la semantica (resta un MVCC delete, i lettori vedono i dati vecchi
  -- fino al commit, mai la tabella vuota).
  delete from trip_updates where true;
  insert into trip_updates (trip_id, stop_sequence, route_id, stop_id, direction_id,
                            arrival_ts, departure_ts, delay, updated_at)
  select x.trip_id, x.stop_sequence, x.route_id, x.stop_id, x.direction_id,
         x.arrival_ts, x.departure_ts, x.delay, coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_rows) as x(
    trip_id text, stop_sequence int, route_id text, stop_id text, direction_id smallint,
    arrival_ts timestamptz, departure_ts timestamptz, delay int, updated_at timestamptz
  );
  get diagnostics n = row_count;
  return n;
end $$;

-- Stessa correzione safeupdate (where true) sullo swap degli alert.
create or replace function replace_service_alerts(p_rows jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('replace_service_alerts'));
  delete from service_alerts where true;
  insert into service_alerts (id, header, description, cause, effect,
                              route_ids, stop_ids, start_ts, end_ts, updated_at)
  select x.id, x.header, x.description, x.cause, x.effect,
         coalesce(x.route_ids, '{}'), coalesce(x.stop_ids, '{}'),
         x.start_ts, x.end_ts, coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_rows) as x(
    id text, header text, description text, cause text, effect text,
    route_ids text[], stop_ids text[], start_ts timestamptz, end_ts timestamptz,
    updated_at timestamptz
  );
  get diagnostics n = row_count;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- stop_arrivals: direzione dal realtime (#1) + dedup sull'orario programmato (#2).
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
           coalesce(tu.direction_id, vp.direction_id)::smallint as direction_id
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
        -- confronto sull'orario PROGRAMMATO del realtime (eta - delay), così la
        -- dedup regge anche con ritardi grandi (#2).
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
-- route_stop_arrivals: dedup sull'orario programmato del realtime (#2).
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
           (select rs.headsign from route_stops rs
            where rs.route_id = p_route_id and rs.stop_id = p_stop_id limit 1) as headsign,
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
-- nearby_arrivals: direzione dal realtime (#1, rimosso il join morto a
-- stg_trips) + dedup sull'orario programmato del realtime (#2).
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
           coalesce(tu.direction_id, vp.direction_id)::smallint as direction_id
    from nearby n
    join trip_updates tu on tu.stop_id = n.stop_id
    left join vehicle_positions vp on vp.trip_id = tu.trip_id
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
