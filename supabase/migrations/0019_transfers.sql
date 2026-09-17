-- ============================================================================
-- 0019_transfers.sql — Trasferimenti a piedi tra fermate.
--
-- Il router ha bisogno, per ogni fermata, delle fermate raggiungibili a piedi:
-- è il secondo ingrediente del calcolo percorsi, dopo timetable (0018).
--
-- Raggio: misurato prima di scegliere. Le coppie entro 300m sono 56.932,
-- entro 500m 135.324, entro 800m 306.622 su 8.325 fermate. Anche il caso più
-- largo è una tabella piccola, quindi la dimensione NON è il vincolo.
-- Il vincolo è la qualità: un trasferimento di 800 metri a piedi è
-- tecnicamente ottimo e praticamente assurdo, e l'errore della distanza in
-- linea d'aria cresce col raggio.
-- Scelta: si materializza a 800m e il limite effettivo lo applica il router
-- (default previsto 500m). Così cambiare tolleranza è una manopola del codice
-- e non richiede un nuovo ETL da 5 milioni di righe.
--
-- Simmetria: la tabella contiene entrambi i versi, (a,b) e (b,a). Il router
-- cerca sempre "da dove sono", quindi la PK (from_stop_id, to_stop_id) copre
-- già l'accesso e non serve nessun indice aggiuntivo.
--
-- Solo metri, non minuti: la velocità di cammino e il fattore di detour sono
-- politica del router, non fatti del dato. Il feed di Roma non ha
-- parent_station (il parser legge solo id, code, name, lat, lon), quindi le
-- banchine dello stesso nodo non sono raggruppate: ci pensa la distanza, che
-- tra due banchine a 20 metri genera comunque un trasferimento.
--
-- NOTA sulle distanze: sono in linea d'aria. A Roma questo mente dove c'è di
-- mezzo il Tevere o un fascio di binari, e nessun raggio lo risolve. La
-- correzione vera è una rete stradale OSM, fuori dalla v1: il router applicherà
-- un fattore di detour per approssimare il percorso reale.
--
-- Come timetable, questa tabella si popola al prossimo ETL statico.
-- ============================================================================

create table if not exists transfers (
  from_stop_id text    not null,
  to_stop_id   text    not null,
  meters       integer not null,
  primary key (from_stop_id, to_stop_id)
);

-- ----------------------------------------------------------------------------
-- rebuild_static_from_staging: identica a 0018 (che a sua volta preserva la
-- selezione del trip rappresentativo lineare di 0014) con un solo blocco
-- aggiunto, marcato NUOVO. Il blocco sta dopo stops perché ne legge geom.
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

  -- NUOVO: trasferimenti a piedi entro 800m, entrambi i versi.
  -- st_dwithin in gradi fa da prefiltro sfruttando l'indice GiST su geom
  -- (0,013° valgono almeno 1,08 km alla latitudine di Roma, quindi non perde
  -- coppie); la distanza esatta in metri arriva poi da geography.
  truncate transfers;
  insert into transfers (from_stop_id, to_stop_id, meters)
  select a.stop_id, b.stop_id,
         round(st_distance(a.geom::geography, b.geom::geography))::integer
  from stops a
  join stops b
    on a.stop_id <> b.stop_id
   and st_dwithin(a.geom, b.geom, 0.013)
  where st_distance(a.geom::geography, b.geom::geography) <= 800;

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
  -- service_id serve a sapere quali corse viaggiano in una data (0018).
  truncate trips;
  insert into trips (trip_id, route_id, direction_id, headsign, service_id)
  select trip_id, route_id, coalesce(direction_id, 0), nullif(trip_headsign, ''),
         service_id
  from stg_trips;

  -- timetable: la tripla (corsa, fermata, orario) per il router (0018).
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
