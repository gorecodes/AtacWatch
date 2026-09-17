-- ============================================================================
-- 0018_timetable.sql — Persiste la tripla (corsa, fermata, orario).
--
-- Perché serve: lo schema attuale è costruito attorno alla domanda della
-- palina ("cosa parte da questa fermata") e per rispondervi AGGREGA via
-- l'identità della corsa. stop_schedule tiene
--   (stop_id, route_id, direction_id, service_id) -> [orari]
-- quindi si sa che il 64 parte alle 8:03 e alle 8:11, ma non QUALE corsa sia:
-- è impossibile seguirla per sapere quando lo stesso mezzo arriva alle fermate
-- successive. Un calcolo percorsi costruito su questi dati può solo stimare i
-- tempi di percorrenza, e le stime si sommano a ogni cambio.
--
-- Il dato però esiste: stg_stop_times lo contiene a ogni ETL e viene troncata
-- in fondo al rebuild. Qui lo si conserva.
--
-- Sosta zero: il feed di Roma passa da gtfsTimeToSeconds(departure_time ||
-- arrival_time), quindi per ogni fermata c'è UN solo orario. Il router tratterà
-- departure_s come arrivo e partenza insieme. Sui bus la sosta è nell'ordine
-- dei secondi, quindi l'approssimazione è accettabile; va ricordata se un
-- giorno si aggiungessero i treni regionali, dove non lo sarebbe.
--
-- Dimensioni: ~5,4 milioni di righe per tutti i 1634 servizi del feed, di cui
-- ~1,14 milioni attivi in un giorno tipo. Nessun indice oltre alla primary
-- key: il caricamento del router filtra per servizio passando da
-- trips(service_id) e poi pesca su timetable per trip_id, che è il prefisso
-- della PK. Un indice su stop_id costerebbe ~150MB di cache senza servire a
-- nessuno degli accessi previsti, e il VPS ha 4GB.
--
-- Dopo questa migration timetable è VUOTA: si popola al prossimo ETL statico
-- (deploy/atacwatch-ingest.service, oppure a mano con
-- `docker compose run --rm worker node_modules/.bin/tsx scripts/ingest-static.ts`).
-- ============================================================================

create table if not exists timetable (
  trip_id       text    not null,
  stop_sequence integer not null,
  stop_id       text    not null,
  departure_s   integer not null,
  primary key (trip_id, stop_sequence)
);

-- service_id sulle corse: senza di questo non si sa quali corse viaggiano in
-- una data, perché calendar è vuoto e Roma usa solo calendar_dates.
alter table trips add column if not exists service_id text;
create index if not exists trips_service_idx on trips (service_id);

-- ----------------------------------------------------------------------------
-- rebuild_static_from_staging: identica a 0014 (compresa la scelta del trip
-- rappresentativo lineare) con due sole aggiunte, marcate NUOVO qui sotto.
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
  -- NUOVO: porta anche service_id, per sapere quali corse viaggiano in una data.
  truncate trips;
  insert into trips (trip_id, route_id, direction_id, headsign, service_id)
  select trip_id, route_id, coalesce(direction_id, 0), nullif(trip_headsign, ''),
         service_id
  from stg_trips;

  -- NUOVO: timetable, il dato che prima si perdeva col truncate delle staging.
  truncate timetable;
  insert into timetable (trip_id, stop_sequence, stop_id, departure_s)
  select st.trip_id, st.stop_sequence, st.stop_id, st.departure_s
  from stg_stop_times st
  where st.departure_s is not null
    and st.trip_id is not null
    and st.stop_id is not null;

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
