-- RIPRISTINO DI EMERGENZA per stop_arrivals.
--
-- Questa e' la definizione in vigore PRIMA della 0031, copiata dalla 0013 senza
-- toccare una virgola. Se il filtro sui capolinea facesse danni e l'interruttore
-- non bastasse, si torna indietro con un comando solo:
--
--   docker compose exec -T db psql -U atacwatch -d atacwatch \
--     -v ON_ERROR_STOP=1 -f - < rollback/stop_arrivals_prima_di_0031.sql
--
-- Non e' una migration: sta fuori da supabase/migrations apposta, cosi' nessuno
-- la applica per sbaglio in sequenza.

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
