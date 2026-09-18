-- ============================================================================
-- 0027_delay_stats_per_corsa.sql — Si conta una corsa, non un minuto.
--
-- IL DIFETTO. record_delay_sample() gira ogni minuto e a ogni giro inserisce
-- una osservazione per ogni corsa attiva. Una corsa dura 40-60 minuti, quindi
-- LA STESSA CORSA finiva nel campione decine di volte, e sempre con lo stesso
-- ritardo. Misurato in produzione: la linea 51 aveva 203 "campioni" in un'ora,
-- ma con ~3 mezzi in linea erano 3 corse contate 60 volte ciascuna.
--
-- L'effetto è che le percentuali non significavano quello che dicevano:
-- "97% in ritardo" non era "97 corse su 100 arrivano in ritardo" ma "il mezzo
-- che stavamo guardando era in ritardo per quasi tutto il tempo in cui l'ho
-- guardato". E la soglia dei 200 campioni, messa per dare solidità al dato,
-- dava solidità a n=3 travestito da n=200.
--
-- Peggio: un mezzo in ritardo resta nel feed più a lungo di uno puntuale
-- (finisce il giro dopo), quindi produce più osservazioni. Il campionamento
-- a tempo sovrappesa strutturalmente i ritardatari.
--
-- LA SOLUZIONE. Una tabella di appoggio con chiave (trip_id, hour_bucket):
-- ogni corsa conta UNA volta per fascia oraria, qualunque sia il numero di
-- tick in cui la vediamo. delay_stats viene ricalcolata da lì a ogni giro —
-- è un'aggregazione su poche migliaia di righe, costa niente.
--
-- Si tiene l'ULTIMO ritardo visto per la corsa nell'ora: è lo stato più
-- recente che conosciamo di quel mezzo, ed è l'unica scelta che non richiede
-- di decidere arbitrariamente se è più vero l'inizio o il picco.
--
-- ANCHE: late5_count, il ritardo oltre i 5 minuti. La soglia dei 2 minuti è
-- severa per un bus urbano, e su una linea il cui orario GTFS è ottimista di
-- tre minuti fa risultare in ritardo ogni singola corsa pur essendo regolare.
-- Averle entrambe in tabella permette di cambiare idea su cosa mostrare senza
-- rifare la raccolta — la stessa lezione di zero_count in 0025.
--
-- La tabella viene svuotata: i conteggi vecchi sono per-osservazione e non si
-- possono convertire in per-corsa a posteriori.
-- ============================================================================

alter table delay_stats add column if not exists late5_count integer not null default 0;

truncate delay_stats;

-- Appoggio: una riga per corsa per ora. Non è storia, è il grezzo da cui si
-- ricava delay_stats; si pota dopo una settimana (vedi in fondo).
create table if not exists delay_trip_samples (
  trip_id      text        not null,
  hour_bucket  timestamptz not null,
  route_id     text        not null,
  direction_id smallint    not null,
  delay        integer     not null,
  updated_at   timestamptz not null default now(),
  primary key (trip_id, hour_bucket)
);

-- Per l'aggregazione oraria, che è l'unica lettura pesante.
create index if not exists delay_trip_samples_bucket_idx
  on delay_trip_samples (hour_bucket);

create or replace function record_delay_sample()
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
  bucket timestamptz := date_trunc('hour', now());
begin
  -- 1) Una riga per corsa attiva, con il suo ritardo alla prossima fermata.
  --    L'upsert sulla PK (trip_id, hour_bucket) fa sì che rivedere la stessa
  --    corsa al tick successivo AGGIORNI la riga invece di aggiungerne una.
  with next_stop as (
    select distinct on (tu.trip_id)
           tu.trip_id,
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
  insert into delay_trip_samples (trip_id, hour_bucket, route_id, direction_id, delay)
  select trip_id, bucket, route_id, direction_id, delay
    from next_stop
  on conflict (trip_id, hour_bucket) do update set
     delay      = excluded.delay,
     updated_at = now();

  get diagnostics n = row_count;

  -- 2) Ricalcola delay_stats per l'ora corrente dalle corse distinte.
  --    Si cancella e si riscrive invece di accumulare: accumulare è ciò che
  --    contava la stessa corsa più volte.
  delete from delay_stats where hour_bucket = bucket;

  insert into delay_stats
         (route_id, direction_id, hour_bucket,
          sample_count, delay_sum, delay_max, late_count, zero_count, late5_count)
  select route_id,
         direction_id,
         bucket,
         count(*),
         sum(delay),
         max(delay),
         count(*) filter (where delay > 120),
         count(*) filter (where delay = 0),
         count(*) filter (where delay > 300)
    from delay_trip_samples
   where hour_bucket = bucket
   group by route_id, direction_id;

  -- 3) Potatura. delay_stats è la storia; il grezzo serve solo a ricalcolare
  --    l'ora in corso. Una settimana lascia il margine per ri-derivare le
  --    statistiche con una soglia diversa senza rifare la raccolta.
  delete from delay_trip_samples where hour_bucket < now() - interval '7 days';

  return n;
end $$;
