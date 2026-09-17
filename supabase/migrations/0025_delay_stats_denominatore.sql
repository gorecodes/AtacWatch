-- ============================================================================
-- 0025_delay_stats_denominatore.sql — I puntuali rientrano nel denominatore.
--
-- 0016 scartava `delay = 0` dal campione, ed era una scelta difendibile per
-- MOSTRARE un ritardo: uno zero nel feed ATAC spesso significa "dato assente"
-- e non "in orario", quindi scriverlo in pagina sarebbe stato fuorviante.
--
-- Per le STATISTICHE però è fatale: escludere gli zeri toglie dal denominatore
-- tutti i mezzi puntuali. Con i primi dati raccolti veniva un ritardo medio di
-- 23 minuti e un 88% di corse in ritardo, numeri che nessuno crederebbe e che
-- infatti non significano "l'88% dei bus è in ritardo" ma "l'88% di quelli per
-- cui ATAC dichiara uno scostamento". Una percentuale così non si può mettere
-- in pagina.
--
-- Ora gli zeri entrano nel campione e vengono ANCHE contati a parte
-- (zero_count): la media e la percentuale diventano leggibili, e se un domani
-- si scoprisse che quegli zeri sono spazzatura si possono sottrarre senza
-- rifare la raccolta.
--
-- La tabella viene SVUOTATA. Il giorno di dati già raccolto è calcolato col
-- denominatore sbagliato, e mescolarlo al nuovo darebbe medie che non
-- significano niente: dati distorti sono peggio di nessun dato.
-- ============================================================================

alter table delay_stats add column if not exists zero_count integer not null default 0;

truncate delay_stats;

create or replace function record_delay_sample()
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with next_stop as (
    -- Una riga per corsa: la prossima fermata che deve ancora servire.
    select distinct on (tu.trip_id)
           tu.route_id,
           coalesce(tu.direction_id, -1)::smallint as direction_id,
           tu.delay
      from trip_updates tu
     where tu.delay is not null
       and tu.route_id is not null
       and coalesce(tu.arrival_ts, tu.departure_ts) >= now()
       -- Solo fermate imminenti: oltre questo orizzonte il delay di ATAC è
       -- speculativo. Tiene il campione sullo stato operativo reale del mezzo.
       and coalesce(tu.arrival_ts, tu.departure_ts) < now() + interval '10 minutes'
       -- Lo zero NON si scarta più: è il puntuale, e senza di lui ogni
       -- percentuale è priva di senso. Resta contato a parte.
       -- Banda plausibile: 10 min di anticipo → 45 min di ritardo. Fuori da
       -- qui sono artefatti del feed (visti fino a 3,6 ore), non ritardi.
       and tu.delay between -600 and 2700
     order by tu.trip_id, coalesce(tu.arrival_ts, tu.departure_ts)
  )
  insert into delay_stats as ds
         (route_id, direction_id, hour_bucket,
          sample_count, delay_sum, delay_max, late_count, zero_count)
  select route_id,
         direction_id,
         date_trunc('hour', now()),
         count(*),
         sum(delay),
         max(delay),
         count(*) filter (where delay > 120),
         count(*) filter (where delay = 0)
    from next_stop
   group by route_id, direction_id
  on conflict (route_id, direction_id, hour_bucket) do update set
     sample_count = ds.sample_count + excluded.sample_count,
     delay_sum    = ds.delay_sum    + excluded.delay_sum,
     delay_max    = greatest(ds.delay_max, excluded.delay_max),
     late_count   = ds.late_count   + excluded.late_count,
     zero_count   = ds.zero_count   + excluded.zero_count;

  get diagnostics n = row_count;
  return n;
end $$;
