-- RIPRISTINO DI EMERGENZA per route_stop_arrivals: definizione in vigore prima
-- della 0031, copiata dalla 0009 senza modifiche.
--
--   docker compose exec -T db psql -U atacwatch -d atacwatch \
--     -v ON_ERROR_STOP=1 -f - < rollback/route_stop_arrivals_prima_di_0031.sql

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
      where abs(extract(epoch from (rr.eta_ts - sc.eta_ts))) < 300
    )
  ) m
  order by minutes asc, is_realtime desc
  limit 5;
$$;
