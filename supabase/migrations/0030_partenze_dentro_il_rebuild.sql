-- Le regole delle partenze dentro il rebuild, dove devono stare.
--
-- La 0029 aveva messo la regola in una funzione a parte, da chiamare DOPO il
-- rebuild. Sbagliato, e il motivo e' che rebuild_static_from_staging SVUOTA le
-- tabelle di staging alla fine: quella funzione le avrebbe trovate vuote e
-- avrebbe riscritto stop_schedule con zero righe, cancellando orari e arrivi
-- programmati di tutta l'app al primo ETL. Non e' successo solo perche' la
-- guardia sulle staging vuote ha fatto da paracadute.
--
-- Qui la regola sta dentro il rebuild, subito prima del truncate dello
-- staging: e' l'unico punto in cui i dati per applicarla esistono.

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
  --
  -- SOLO LE PARTENZE VERE. Prima si prendeva OGNI passaggio, e finivano
  -- nell'orario anche gli arrivi di fine corsa e i giri di uscita e rientro in
  -- rimessa: sulla 334 erano 43 righe su 77, e l'ultima "partenza" risultava
  -- alle 00:54 mentre l'ultima vera e' alle 22:00. Su un orario e' peggio di un
  -- dato mancante, perche' chi lo legge esce di casa.
  drop table if exists _estremi;
  create temp table _estremi as
    select trip_id,
           max(stop_sequence) as ultima_seq,
           (array_agg(stop_id order by stop_sequence))[1]      as prima_stop,
           (array_agg(stop_id order by stop_sequence desc))[1] as ultima_stop
      from stg_stop_times
     group by trip_id;
  create index on _estremi (trip_id);

  truncate stop_schedule;
  insert into stop_schedule (stop_id, route_id, direction_id, service_id, headsign, departures)
  select st.stop_id, t.route_id, coalesce(t.direction_id, 0), t.service_id,
         mode() within group (order by t.trip_headsign),
         array_agg(st.departure_s order by st.departure_s)
  from stg_stop_times st
  join stg_trips t on t.trip_id = st.trip_id
  join _estremi e on e.trip_id = st.trip_id
  where st.departure_s is not null
    -- A. Non l'ULTIMA fermata della corsa: su un bus che termina li' non si
    --    sale. Vale per ogni capolinea della rete: 169.150 righe su 794
    --    coppie (linea, fermata), ed e' proprio la fermata da cui si mostrano
    --    le partenze di una linea.
    and st.stop_sequence < e.ultima_seq
    -- B. Non un'uscita o un rientro in rimessa: la corsa parte e torna allo
    --    STESSO deposito, quindi non porta nessuno da nessuna parte. La
    --    condizione e' stretta di proposito: "parte e torna alla stessa
    --    fermata" da sola colpirebbe 19.448 corse, comprese le circolari vere
    --    che tornano a Termini o ad Anagnina. Con "e quella fermata e' un
    --    deposito" (nel feed sono quattro, il nome contiene RIMESSA) le corse
    --    escluse sono 16.
    and not (
      e.prima_stop = e.ultima_stop
      and exists (
        select 1 from stg_stops s
         where s.stop_id = e.ultima_stop and s.stop_name ilike '%rimessa%'
      )
    )
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

-- La funzione della 0029 diventa esplicitamente innocua a staging vuoto:
-- l'ETL la chiama ancora, e deve poter girare senza fare danni.
create or replace function rebuild_stop_schedule() returns void
language plpgsql as $$
begin
  if not exists (select 1 from stg_stop_times limit 1) then
    raise notice 'staging vuote: stop_schedule non toccata';
    return;
  end if;
  perform rebuild_static_from_staging();
end $$;
