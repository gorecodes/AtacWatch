-- ============================================================================
-- 0009_hardening.sql — Correzioni di sicurezza, sincronizzazione e correttezza.
--
-- Contenuto:
--   1. RLS sulle tabelle di staging (stg_*) — niente accesso anon.
--   2. pg_trgm + indici trigram per le ricerche ILIKE (search_routes/stops).
--   3. Swap ATOMICO dei feed realtime (replace_trip_updates/replace_service_alerts)
--      + guard anti-sovrapposizione delle run di ingest-rt (ingest_lock).
--   4. active_services(): helper per i servizi attivi in una data.
--   5. stop_arrivals / route_stop_arrivals: corse oltre la mezzanotte e
--      deduplica realtime/programmato meno aggressiva.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RLS sulle staging: abilitata SENZA policy di select -> anon non legge,
--    il service_role (ETL) bypassa comunque la RLS.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'stg_routes','stg_stops','stg_trips','stg_stop_times','stg_shapes',
    'stg_calendar','stg_calendar_dates'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Indici trigram: le ricerche usano ILIKE '%q%', che NON sfrutta né il btree
--    su lower(short_name) né il gin tsvector. pg_trgm copre ILIKE arbitrari.
-- ----------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists routes_short_name_trgm on routes using gin (short_name gin_trgm_ops);
create index if not exists routes_long_name_trgm  on routes using gin (long_name  gin_trgm_ops);
create index if not exists stops_name_trgm         on stops  using gin (name       gin_trgm_ops);
create index if not exists stops_code_idx          on stops  (code);

-- ----------------------------------------------------------------------------
-- 3a. Guard anti-sovrapposizione delle run di ingest-rt.
--     pg_cron lancia la Edge Function ogni minuto in fire-and-forget: due run
--     concorrenti interlaccerebbero lo svuota+reinserisci. Questo lock con TTL
--     fa uscire subito le run sovrapposte (e si auto-rilascia se "stale").
-- ----------------------------------------------------------------------------
create table if not exists ingest_lock (
  id        text primary key,
  locked_at timestamptz not null
);
alter table ingest_lock enable row level security;  -- nessuna policy: anon escluso

create or replace function ingest_rt_try_begin(p_ttl_seconds int default 120)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare ok boolean;
begin
  insert into ingest_lock (id, locked_at) values ('ingest-rt', now())
  on conflict (id) do update set locked_at = now()
    where ingest_lock.locked_at < now() - make_interval(secs => p_ttl_seconds)
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function ingest_rt_end()
returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from ingest_lock where id = 'ingest-rt';
$$;

-- 3b. Swap ATOMICO dei feed: tutto il corpo della funzione gira in UNA
--     transazione, quindi i lettori vedono i dati vecchi fino al commit (mai la
--     tabella vuota). pg_advisory_xact_lock serializza eventuali swap concorrenti.
create or replace function replace_trip_updates(p_rows jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('replace_trip_updates'));
  delete from trip_updates;
  insert into trip_updates (trip_id, stop_sequence, route_id, stop_id,
                            arrival_ts, departure_ts, delay, updated_at)
  select x.trip_id, x.stop_sequence, x.route_id, x.stop_id,
         x.arrival_ts, x.departure_ts, x.delay, coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_rows) as x(
    trip_id text, stop_sequence int, route_id text, stop_id text,
    arrival_ts timestamptz, departure_ts timestamptz, delay int, updated_at timestamptz
  );
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function replace_service_alerts(p_rows jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('replace_service_alerts'));
  delete from service_alerts;
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
-- 4. Servizi attivi in una data (calendar + eccezioni). Centralizza la logica
--    usata dalle RPC degli arrivi, così è riusabile per "oggi" e per "ieri"
--    (necessario per le corse GTFS oltre la mezzanotte, dep >= 86400s).
-- ----------------------------------------------------------------------------
create or replace function active_services(p_date date)
returns table (service_id text)
language sql stable set search_path = public as $$
  select c.service_id from calendar c
  where c.start_date <= p_date and c.end_date >= p_date
    and case extract(dow from p_date)
          when 0 then c.sunday when 1 then c.monday when 2 then c.tuesday
          when 3 then c.wednesday when 4 then c.thursday when 5 then c.friday
          when 6 then c.saturday end
  union
  select cd.service_id from calendar_dates cd
  where cd.date = p_date and cd.exception_type = 1
  except
  select cd.service_id from calendar_dates cd
  where cd.date = p_date and cd.exception_type = 2
$$;

-- ----------------------------------------------------------------------------
-- 5a. stop_arrivals: arrivi a una fermata (realtime + programmato).
--     - include le corse oltre la mezzanotte del giorno-servizio precedente;
--     - deduplica un passaggio programmato solo se esiste un realtime della
--       stessa linea/verso entro ±5 min (non azzera più tutti gli orari).
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
  -- Servizi attivi oggi e ieri (ieri serve per le corse oltre la mezzanotte).
  act_today as (select service_id from active_services((select today from p))),
  act_yday  as (select service_id from active_services((select yday  from p))),
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
  -- Orari programmati: oggi (offset 0) + ieri per le corse oltre mezzanotte.
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
        and abs(extract(epoch from (rr.eta_ts - sc.eta_ts))) < 300
    )
  )
  select * from merged
  order by minutes asc, is_realtime desc
  limit 25;
$$;

-- ----------------------------------------------------------------------------
-- 5b. route_stop_arrivals: prossimi passaggi di UNA linea a UNA fermata.
--     Stesse correzioni (oltre mezzanotte + dedup non azzerante).
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
      where abs(extract(epoch from (rr.eta_ts - sc.eta_ts))) < 300
    )
  ) m
  order by minutes asc, is_realtime desc
  limit 5;
$$;
