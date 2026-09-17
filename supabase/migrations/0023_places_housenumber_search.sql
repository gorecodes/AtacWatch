-- ============================================================================
-- 0023_places_housenumber_search.sql — Il civico ordina, non filtra.
--
-- Difetto segnalato: "non trova tutti i civici". Vero in parte per copertura
-- dei dati (OSM ha 81.261 indirizzi di Roma su alcune centinaia di migliaia
-- reali), ma c'era anche un difetto mio, peggiore.
--
-- La ricerca pretendeva TUTTE le parole digitate, numero compreso. Quindi
-- "Via del Corso 300", con quel civico assente da OSM, restituiva ZERO
-- risultati: non solo mancava il numero, spariva anche la via. Chi cerca
-- conclude che l'app non conosca nemmeno la strada.
--
-- Ora i termini numerici sono esclusi dalla condizione e usati solo per
-- ordinare: un civico che corrisponde esattamente va in testa, altrimenti
-- compaiono la via e i civici vicini. Cercare un numero che non esiste dà la
-- via, che è una risposta utile.
-- ============================================================================

drop function if exists search_places(text);
create function search_places(q text)
returns table (id text, kind text, label text, locality text,
               lon double precision, lat double precision)
language sql stable as $$
  with tok as (
    -- I caratteri non alfanumerici vanno via: to_tsquery altrimenti solleva
    -- errore su un apostrofo o una virgola digitati per caso.
    select regexp_replace(w, '[^[:alnum:]]', '', 'g') as w
    from regexp_split_to_table(lower(coalesce(q, '')), '\s+') as w
  ),
  parole as (
    select w from tok where w <> '' and w !~ '^[0-9]'
  ),
  numero as (
    -- Il primo termine che inizia per cifra è il civico ("12", "12A").
    select w from tok where w ~ '^[0-9]' limit 1
  ),
  tq as (
    -- ':*' su ogni parola aggancia i prefissi mentre si digita; '&' impone che
    -- ci siano tutte, in qualunque ordine.
    select string_agg(w || ':*', ' & ') as s from parole
  )
  select p.id, p.kind, p.label, p.locality, st_x(p.geom), st_y(p.geom)
  from places p, tq
  left join numero n on true
  where tq.s is not null
    and to_tsvector('simple', p.label) @@ to_tsquery('simple', tq.s)
  order by
    -- Se è stato digitato un civico e coincide, è quello che si cercava.
    -- Il coalesce è indispensabile: per una via housenumber è NULL, quindi
    -- il confronto vale NULL, e in ORDER BY ... DESC i NULL vengono PRIMI.
    -- Senza, le vie scavalcavano il civico esatto che era stato digitato.
    coalesce(lower(p.housenumber) = n.w, false) desc,
    (case p.kind when 'street' then 0 when 'poi' then 1 else 2 end),
    p.importance desc,
    -- A parità, prima ciò che ha una fermata vicina: è l'unico raggiungibile.
    (p.locality is not null) desc,
    length(p.label),
    p.label
  limit 25;
$$;
