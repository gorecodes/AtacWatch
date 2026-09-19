-- Regola A anche sul tempo reale: niente mezzi che TERMINANO alla fermata.
--
-- L'orario programmato e' gia' filtrato (0030), ma il tempo reale arriva da
-- un'altra strada - trip_updates - e non passava da li'. Verificato alla
-- fermata RIMESSA ATAC GROTTAROSSA: l'unico arrivo mostrato era un 334 in
-- posizione 20 su 20, cioe' un bus che finiva la corsa li' e andava in rimessa.
--
-- DUE VIE D'USCITA, perche' questa funzione serve la schermata piu' importante
-- dell'app e un filtro sbagliato si vedrebbe su tutte le fermate di Roma:
--
--   1. L'INTERRUTTORE. Si spegne con una riga, senza deploy, effetto immediato:
--        update impostazioni set valore = false
--         where chiave = 'arrivi_senza_capolinea';
--      La funzione lo rilegge a ogni chiamata.
--
--   2. IL RIPRISTINO COMPLETO. rollback/stop_arrivals_prima_di_0031.sql
--      contiene la definizione precedente intatta: un psql e si torna esatti.

create table if not exists impostazioni (
  chiave text primary key,
  valore boolean not null,
  nota   text
);

insert into impostazioni (chiave, valore, nota)
values ('arrivi_senza_capolinea', true,
        'Nasconde dagli arrivi i mezzi che terminano la corsa alla fermata')
on conflict (chiave) do nothing;

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
      -- REGOLA A SUL TEMPO REALE: non si mostra un mezzo che TERMINA qui. Su
      -- quello non ci si sale: e' un arrivo, non un passaggio utile. E' la
      -- stessa regola gia' applicata all'orario programmato (0030), portata
      -- sull'altra strada, quella del feed in tempo reale.
      --
      -- Si confronta lo STOP_ID dell'ultima fermata e non il numero di
      -- sequenza: la numerazione del feed in tempo reale e quella dello
      -- statico non sono garantite identiche, l'identita' della fermata si'.
      --
      -- coalesce(..., true): se la corsa non esiste nello statico - una corsa
      -- aggiunta al volo dal feed - la si TIENE. Senza, il confronto con NULL
      -- la farebbe sparire in silenzio, che e' il modo peggiore di sbagliare.
      and (
        not coalesce(
          (select valore from impostazioni where chiave = 'arrivi_senza_capolinea'),
          true)
        or coalesce(
             tu.stop_id <> (
               select tt.stop_id from timetable tt
                where tt.trip_id = tu.trip_id
                order by tt.stop_sequence desc
                limit 1
             ),
             true)
      )
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
-- E la stessa regola su route_stop_arrivals: la sezione "Partenze da ..." della
-- pagina di una linea passa di qui, non da stop_arrivals, e mostrava lo stesso
-- mezzo in rientro che stop_arrivals mostrava alla fermata.
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
      -- REGOLA A, anche qui: e' la TERZA strada per cui un mezzo che termina
      -- alla fermata finiva mostrato come passaggio utile. La sezione
      -- "Partenze da ..." della pagina di una linea legge questa funzione, e
      -- mostrava in verde un 334 delle 22:50 diretto in rimessa mentre
      -- l'orario, gia' corretto, si fermava alle 22:00.
      and (
        not coalesce(
          (select valore from impostazioni where chiave = 'arrivi_senza_capolinea'),
          true)
        or coalesce(
             tu.stop_id <> (
               select tt.stop_id from timetable tt
                where tt.trip_id = tu.trip_id
                order by tt.stop_sequence desc
                limit 1
             ),
             true)
      )
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
