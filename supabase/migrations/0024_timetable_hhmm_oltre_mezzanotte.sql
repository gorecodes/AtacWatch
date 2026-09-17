-- ============================================================================
-- 0024_timetable_hhmm_oltre_mezzanotte.sql
--
-- Nell'orario completo di una linea comparivano voci come "26:32" invece di
-- "02:32". Nel GTFS il servizio dopo mezzanotte appartiene al giorno
-- precedente e si scrive con ore oltre le 24 — la 38 arriva a 26:32, cioè
-- 02:32 — ma quella convenzione è un fatto del FORMATO, non qualcosa da
-- mostrare a chi aspetta l'autobus.
--
-- La funzione divideva per 3600 senza modulo 24. L'equivalente TypeScript
-- (secondsToHHMM in lib/gtfs.ts) il modulo ce l'aveva già: era solo la
-- versione SQL a non averlo.
--
-- departure_s resta il valore grezzo, perché LineDetail lo confronta con
-- l'ora corrente per barrare le corse già passate: normalizzarlo lì
-- romperebbe quel confronto.
-- ============================================================================

create or replace function line_full_timetable(
  p_route_id     text,
  p_stop_id      text,
  p_direction_id smallint,
  p_date         date default current_date
) returns table (departure_s int, hhmm text) as $$
  select s.dep,
         lpad(((s.dep / 3600) % 24)::text, 2, '0') || ':' ||
         lpad(((s.dep % 3600) / 60)::text, 2, '0')
  from stop_schedule ss,
       unnest(ss.departures) s(dep)
  where ss.route_id     = p_route_id
    and ss.stop_id      = p_stop_id
    and ss.direction_id = p_direction_id
    and ss.service_id in (select service_id from active_services(p_date))
  order by s.dep
$$ language sql stable;
