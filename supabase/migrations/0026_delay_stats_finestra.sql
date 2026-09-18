-- ============================================================================
-- 0026_delay_stats_finestra.sql — Rimuove la finestra dei 10 minuti.
--
-- 0025 aveva aggiunto un filtro "solo fermate entro 10 minuti" per evitare di
-- usare stime di ATAC troppo lontane nel tempo. L'idea era difendibile, ma
-- produceva un bias sistematico che rendeva le statistiche inutilizzabili:
--
-- - Un bus IN ANTICIPO ha la prossima fermata più lontana nel tempo → escluso
-- - Un bus IN RITARDO ha la prossima fermata più vicina nel tempo → incluso
--
-- Con il 56% dei campioni in anticipo nel feed ATAC, escluderli tutti dalla
-- finestra gonfiava le percentuali di ritardo all'80-95%. Il numero non era
-- sbagliato per un errore di calcolo: era sbagliato il campione.
--
-- La soluzione è prendere la prossima fermata futura di ogni corsa senza
-- limite superiore. Il `distinct on` + `order by` garantisce che sia davvero
-- la PROSSIMA, non una qualsiasi. Il filtro sulla banda dei delay (-600 e 2700)
-- continua a scartare gli artefatti del feed.
--
-- La tabella viene svuotata perché mescolare i dati raccolti col campione
-- distorto ai nuovi darebbe medie senza senso.
-- ============================================================================

truncate delay_stats;

create or replace function record_delay_sample()
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with next_stop as (
    -- Una riga per corsa: la prossima fermata che deve ancora servire.
    -- Nessun limite superiore sul tempo: un bus in anticipo ha la prossima
    -- fermata più lontana nel futuro, e tagliare quella finestra lo esclude
    -- sistematicamente dal campione (vedi commento in cima a questo file).
    select distinct on (tu.trip_id)
           tu.route_id,
           coalesce(tu.direction_id, -1)::smallint as direction_id,
           tu.delay
      from trip_updates tu
     where tu.delay is not null
       and tu.route_id is not null
       and coalesce(tu.arrival_ts, tu.departure_ts) >= now()
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
