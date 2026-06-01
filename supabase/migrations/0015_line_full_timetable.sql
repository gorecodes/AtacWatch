-- Orario giornaliero completo di una linea a una fermata.
-- Restituisce tutti gli orari previsti per il giorno indicato,
-- senza il filtro temporale delle 90 minuti usato dalle RPC di arrivi.
create or replace function line_full_timetable(
  p_route_id     text,
  p_stop_id      text,
  p_direction_id smallint,
  p_date         date default current_date
) returns table (departure_s int, hhmm text) as $$
  select s.dep,
         lpad((s.dep / 3600)::text, 2, '0') || ':' || lpad(((s.dep % 3600) / 60)::text, 2, '0')
  from stop_schedule ss,
       unnest(ss.departures) s(dep)
  where ss.route_id     = p_route_id
    and ss.stop_id      = p_stop_id
    and ss.direction_id = p_direction_id
    and ss.service_id in (select service_id from active_services(p_date))
  order by s.dep
$$ language sql stable;
