-- L'orario mostrava ARRIVI e RIENTRI IN RIMESSA come se fossero partenze.
--
-- Segnalato dall'uso, sulla 334: il sito ATAC dice 05:30–22:00, noi si
-- arrivava a 00:54. Misurato sul feed, alla fermata RIMESSA ATAC GROTTAROSSA
-- (78306) per il servizio attivo, le righe erano 77 in quattro forme diverse:
--
--   34  verso 0, PRIMA fermata, 40 fermate, RIMESSA -> BASEGGIO
--         le partenze vere: 05:30 -> 22:00, esattamente l'orario ATAC
--   35  verso 1, ULTIMA fermata, 36 fermate, BASEGGIO -> RIMESSA
--         arrivi: bus che terminano la corsa in rimessa
--    4  verso 0, PRIMA fermata, 31 fermate, RIMESSA -> RIMESSA
--         uscite dalla rimessa: 04:45, 05:15, 22:55, 24:00
--    4  verso 0, ULTIMA fermata, 31 fermate
--         i rientri delle stesse, fino a 24:54
--
-- `stop_schedule` prendeva il `departure_time` di OGNI passaggio, quindi
-- metteva nello stesso mucchio le 34 partenze e le 43 righe che partenze non
-- sono. Su un orario e' peggio di un dato mancante: chi legge "00:54" esce di
-- casa.
--
-- DUE REGOLE, e sono state misurate una per una sul feed prima di scriverle:
--
-- A. La fermata non e' l'ULTIMA della corsa. Su un bus che termina li' non ci
--    si sale, quindi quel passaggio non e' una partenza. Vale per tutta la
--    rete: 169.150 righe (una per corsa) su 794 coppie (linea, fermata), cioe'
--    ogni capolinea — ed e' proprio la fermata da cui l'app mostra le
--    partenze.
--
-- B. La corsa non parte e torna allo STESSO DEPOSITO. E' l'uscita o il rientro
--    in rimessa, che non porta nessuno da nessuna parte.
--    La condizione e' stretta di proposito: "parte e torna alla stessa
--    fermata" da sola colpirebbe 19.448 corse, comprese le circolari vere che
--    tornano a Termini, Anagnina o Laurentina. Aggiungendo "e quella fermata
--    e' un deposito" (nel feed sono quattro in tutto, i nomi contengono
--    RIMESSA) le corse escluse diventano 16, tutte della 334.
--
-- Verificato: con A e B insieme, la 334 da quella fermata da' 34 partenze,
-- 05:30 -> 22:00. Il sito ATAC dice 05:30 -> 22:00.
--
-- La correzione si applica in due momenti: subito, ricostruendo la tabella
-- dalle staging che conservano l'ultimo feed, e poi a ogni ETL, perche'
-- l'ingestione chiama questa funzione dopo il rebuild grande (che continua a
-- riempire stop_schedule alla vecchia maniera: rifarla qui costa pochi
-- secondi e tiene la regola in un posto solo).
create or replace function rebuild_stop_schedule() returns void
language plpgsql as $$
begin
  -- I depositi: quattro fermate, riconoscibili dal nome. Si calcolano qui e
  -- non si scrivono a mano, cosi' se ATAC ne aggiunge uno la regola lo copre.
  drop table if exists _depositi;
  create temp table _depositi as
    select stop_id from stg_stops where stop_name ilike '%rimessa%';

  -- Estremi di ogni corsa: prima fermata, ultima fermata, ultima sequenza.
  drop table if exists _estremi;
  create temp table _estremi as
    select st.trip_id,
           min(st.stop_sequence) as prima_seq,
           max(st.stop_sequence) as ultima_seq,
           (array_agg(st.stop_id order by st.stop_sequence))[1] as prima_stop,
           (array_agg(st.stop_id order by st.stop_sequence desc))[1] as ultima_stop
      from stg_stop_times st
     group by st.trip_id;
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
    -- A: non l'ultima fermata della corsa
    and st.stop_sequence < e.ultima_seq
    -- B: non un'uscita o un rientro in rimessa
    and not (
      e.prima_stop = e.ultima_stop
      and e.ultima_stop in (select stop_id from _depositi)
    )
  group by st.stop_id, t.route_id, coalesce(t.direction_id, 0), t.service_id;
end $$;

-- SI APPLICA SUBITO, senza aspettare l'ETL di stanotte: le tabelle di staging
-- conservano l'ultimo feed (l'ingestione le svuota all'inizio del giro, non
-- alla fine), quindi qui c'e' gia' tutto quel che serve per ricostruire.
-- Se fossero vuote — prima ingestione mai eseguita — la ricostruzione
-- lascerebbe stop_schedule vuota, quindi si salta.
do $$
begin
  if exists (select 1 from stg_stop_times limit 1) then
    perform rebuild_stop_schedule();
  end if;
end $$;
