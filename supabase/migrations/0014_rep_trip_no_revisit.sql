-- ============================================================================
-- 0014_rep_trip_no_revisit.sql — Itinerario di linea pulito su percorsi che
-- ripassano sulla stessa fermata.
--
-- Problema: route_stops/route_shapes usano un "trip rappresentativo" per
-- (route, direction), scelto come quello con PIÙ fermate. Alcune corse fanno
-- giri/andata-ritorno (es. 334 verso/da RIMESSA ATAC GROTTAROSSA) e ripassano
-- sullo stesso stop_id: avendo più fermate vincono la selezione e diventano la
-- "spina dorsale" della linea. Risultato: stessa fermata/nome due volte
-- nell'itinerario e, espandendo gli orari su una fermata ripassata, due set di
-- tempi (gli arrivi "ballano").
--
-- Fix: scegliere come rappresentativo un trip LINEARE (nessuno stop_id
-- ripetuto) quando esiste; a parità, il più lungo. Solo se tutte le corse di
-- quel verso ripassano, si ripiega sul più lungo come prima.
--
-- Cambia solo la CTE _rep_trips dentro rebuild_static_from_staging; tutto il
-- resto è identico a 0013. Richiede un nuovo ETL (pnpm ingest:static) per
-- ricostruire route_stops/route_shapes.
-- ============================================================================

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

  -- trip rappresentativo per (route, direction):
  --   1) preferisci un trip LINEARE (nessuna fermata ripetuta: n = distinte);
  --   2) a parità, quello con più fermate.
  -- Evita che i giri andata/ritorno (che ripassano sulle fermate) diventino
  -- l'itinerario canonico della linea.
  drop table if exists _rep_trips;
  create temp table _rep_trips as
  with trip_len as (
    select t.trip_id, t.route_id, coalesce(t.direction_id, 0) as direction_id,
           t.trip_headsign, t.shape_id,
           count(*) as n,
           count(distinct st.stop_id) as ndistinct
    from stg_trips t
    join stg_stop_times st on st.trip_id = t.trip_id
    group by t.trip_id, t.route_id, coalesce(t.direction_id, 0), t.trip_headsign, t.shape_id
  )
  select distinct on (route_id, direction_id)
         trip_id, route_id, direction_id, trip_headsign, shape_id
  from trip_len
  order by route_id, direction_id, (n = ndistinct) desc, n desc;

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
