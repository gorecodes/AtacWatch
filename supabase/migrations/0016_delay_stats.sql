-- ============================================================================
-- 0016_delay_stats.sql — Storico dei ritardi per linea.
--
-- Il feed GTFS-RT porta già `delay` su ogni stop_time_update, e finisce in
-- trip_updates. Ma `replace_trip_updates` svuota e riscrive la tabella ad ogni
-- tick del worker (60s): lo storico si perde. Qui lo accumuliamo.
--
-- COSA misuriamo: lo STATO, non gli EVENTI.
--   Ad ogni tick prendiamo, per ogni corsa attiva, il ritardo alla sua prossima
--   fermata — un campione per corsa — e lo aggreghiamo nel bucket orario della
--   sua linea. La domanda a cui rispondiamo è "quanto era in ritardo la linea
--   64 durante le 8:00?", non "quante corse sono arrivate in ritardo".
--
--   Questa scelta evita il problema della deduplica: contando eventi dovremmo
--   riconoscere che la stessa corsa vista in due tick consecutivi è lo stesso
--   arrivo (e le eta si spostano proprio perché il bus è in ritardo, quindi la
--   finestra temporale non basta). Campionando uno stato invece è corretto per
--   costruzione: un bus in ritardo per 5 minuti consecutivi viene campionato
--   5 volte, ed è giusto così — è stato in ritardo per 5 minuti.
--
-- COSTO: un solo INSERT aggregato per tick, e ~300 linee × 2 direzioni × 18 ore
-- attive ≈ 11k righe/giorno. Nessuna tabella di campioni grezzi.
--
-- QUALITÀ DEL DATO: il `delay` grezzo di ATAC non è utilizzabile così com'è.
-- Misurato sul feed reale (25.796 valori):
--   - mediana -122s e un terzo delle corse in "anticipo" di oltre 5 minuti:
--     implausibile per dei bus;
--   - le corse la cui prossima fermata è oltre i 5 minuti riportano delay
--     esattamente 0: su quell'orizzonte ATAC non fornisce una stima reale;
--   - il 15,2% dei valori è esattamente 0. Una quantità continua non può
--     centrare lo zero al secondo nel 15% dei casi: è un placeholder "dato
--     assente", non "in orario". Verificato che NON si tratta di
--     arrotondamento al minuto (dei 233 multipli di 60, 202 sono lo zero
--     stesso; gli altri restano nella norma statistica, e ci sono 694 valori
--     distinti su 1.324 campioni).
-- Da qui i tre filtri sotto. Applicandoli la mediana diventa -34s, coerente
-- con dei bus che a una fermata viaggiano poco sotto l'orario.
-- ============================================================================

create table if not exists delay_stats (
  route_id     text        not null,
  -- -1 quando la direzione è sconosciuta: in Postgres i NULL sono distinti tra
  -- loro negli indici unique, e ON CONFLICT non aggancerebbe mai quelle righe.
  direction_id smallint    not null,
  hour_bucket  timestamptz not null,
  sample_count int         not null,
  delay_sum    bigint      not null,
  delay_max    int         not null,
  -- Campioni sopra i 120s: serve a calcolare la % di inaffidabilità della linea.
  late_count   int         not null,
  primary key (route_id, direction_id, hour_bucket)
);

create index if not exists delay_stats_hour_idx on delay_stats (hour_bucket desc);

-- ----------------------------------------------------------------------------
-- Campionamento: chiamata dal worker ad ogni tick, dopo replace_trip_updates.
-- Ritorna il numero di gruppi (linea, direzione) aggiornati.
-- ----------------------------------------------------------------------------
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
       -- speculativo (e di fatto vale 0). Tiene il campione sullo stato
       -- operativo reale del mezzo.
       and coalesce(tu.arrival_ts, tu.departure_ts) < now() + interval '10 minutes'
       -- Scarta il placeholder "dato assente" (vedi nota in testa al file).
       and tu.delay <> 0
       -- Banda plausibile: 10 min di anticipo → 45 min di ritardo. Fuori da
       -- qui sono artefatti del feed (visti fino a 3,6 ore), non ritardi.
       and tu.delay between -600 and 2700
     order by tu.trip_id, coalesce(tu.arrival_ts, tu.departure_ts)
  )
  insert into delay_stats as ds
         (route_id, direction_id, hour_bucket,
          sample_count, delay_sum, delay_max, late_count)
  select route_id,
         direction_id,
         date_trunc('hour', now()),
         count(*),
         sum(delay),
         max(delay),
         count(*) filter (where delay > 120)
    from next_stop
   group by route_id, direction_id
  on conflict (route_id, direction_id, hour_bucket) do update set
     sample_count = ds.sample_count + excluded.sample_count,
     delay_sum    = ds.delay_sum    + excluded.delay_sum,
     delay_max    = greatest(ds.delay_max, excluded.delay_max),
     late_count   = ds.late_count   + excluded.late_count;

  get diagnostics n = row_count;
  return n;
end $$;
