-- L'orario completo rispondeva VUOTO quando la data non veniva passata.
--
-- line_full_timetable dichiara `p_date date default current_date`, ma
-- /api/routes/:id/timetable passa `dateParam ?? null`: un NULL ESPLICITO non
-- attiva il default di Postgres, quindi la funzione chiamava
-- active_services(NULL), che non torna nessun servizio, e l'orario usciva
-- vuoto. Il web non lo vedeva perche' passa sempre `date`; un client che si
-- fidasse del default — l'app Android — avrebbe ricevuto una lista vuota
-- senza nessun errore.
--
-- Si difende la FUNZIONE invece dell'endpoint: il default resta, e in piu'
-- un NULL passato a mano viene trattato come "oggi". Cosi' la prossima
-- chiamata distratta, da qualunque client, non produce silenzio.
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
    and ss.service_id in (
      select service_id from active_services(coalesce(p_date, current_date))
    )
  order by s.dep
$$ language sql stable;
