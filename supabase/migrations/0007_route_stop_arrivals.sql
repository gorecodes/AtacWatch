-- ============================================================================
-- 0007_route_stop_arrivals.sql — Prossimi passaggi di UNA linea a UNA fermata.
-- Usato dall'espansione "orari" nella vista linea. Realtime se disponibile,
-- altrimenti orario programmato. Restituisce i prossimi passaggi (limit 5).
-- ============================================================================

create or replace function route_stop_arrivals(p_route_id text, p_stop_id text)
returns table (trip_id text, headsign text, eta_ts timestamptz,
               minutes int, is_realtime boolean, delay int)
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
  scheduled_rows as (
    select null::text as trip_id, ss.headsign,
           ((p.today::timestamp + (dep * interval '1 second')) at time zone 'Europe/Rome') as eta_ts,
           ((dep - p.now_seconds) / 60)::int as minutes,
           false as is_realtime, null::int as delay
    from stop_schedule ss
    join active a on a.service_id = ss.service_id
    cross join p
    cross join lateral unnest(ss.departures) as dep
    where ss.stop_id = p_stop_id and ss.route_id = p_route_id
      and dep >= p.now_seconds and dep <= p.now_seconds + 7200
  )
  select * from (
    select * from realtime_rows
    union all
    select * from scheduled_rows
    where not exists (select 1 from realtime_rows)
  ) m
  order by minutes asc, is_realtime desc
  limit 5;
$$;
