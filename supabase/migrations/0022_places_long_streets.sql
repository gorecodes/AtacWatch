-- ============================================================================
-- 0022_places_long_streets.sql — Vie lunghe spezzate e riferimento di zona.
--
-- Difetto trovato provando "Via Nomentana → Via Appia Nuova": nessun
-- itinerario. La causa non era il router ma il punto scelto per la via.
-- L'Appia Nuova è una consolare di 15 km, e il suo punto di mezzo era caduto
-- in un tratto senza fermate nel feed ATAC: zero fermate di accesso, quindi
-- nessun percorso possibile. Il punto medio di una via lunga non è un
-- indirizzo utile.
--
-- Due rimedi:
--
-- 1. Il punto rappresentativo è ANCORATO ALLA FERMATA più vicina alla via,
--    non al suo centro geometrico. Così ogni via che abbia una fermata nei
--    paraggi è raggiungibile per costruzione, che era il difetto.
--
-- 2. Ogni voce porta il nome di quella fermata come riferimento di zona. A
--    Roma le fermate prendono il nome dagli incroci, quindi "Via Appia Nuova"
--    con riferimento "COLLI ALBANI" dice davvero dove sei. Risolve anche
--    l'altra ambiguità: i due "Via del Corso" a 14,5 km di distanza ora si
--    distinguono a vista.
--
-- Provato e SCARTATO: spezzare le vie lunghe in tratti da un chilometro.
-- OSM divide una strada a ogni incrocio e tiene le carreggiate separate, e la
-- fusione non le ricompone: il risultato erano 46.071 voci con decine di
-- frammenti da 20-180 metri per la sola Appia Nuova, cioè una ricerca peggiore
-- del problema da risolvere.
--
-- Limite che resta: su una consolare di 15 km una voce sola indica un punto
-- solo. Per la precisione ci sono gli 81.000 civici, che sono indirizzi veri.
-- ============================================================================

alter table places add column if not exists locality text;

create or replace function rebuild_places_from_staging() returns void
language plpgsql as $$
begin
  truncate places;

  insert into places (id, kind, name, label, locality, geom, shape, highway, importance)
  with cluster as (
    -- Segmenti con lo stesso nome raggruppati a ~300m: i pezzi contigui
    -- diventano una via, due omonime in quartieri diversi restano distinte.
    select name,
           row_number() over (partition by name) as cn,
           st_linemerge(st_collectionextract(cluster_geom, 2)) as g,
           highway
    from (
      select name,
             mode() within group (order by highway) as highway,
             unnest(st_clusterwithin(geom, 0.003)) as cluster_geom
      from stg_osm_feature
      where kind = 'street' and name is not null
      group by name
    ) k
  ),
  intere as (
    select name, cn, g, highway,
           st_length(g::geography) as len_totale
    from cluster
    where g is not null and not st_isempty(g)
  ),
  -- Fermata più vicina alla VIA, non al suo centro: è l'ancora del punto
  -- rappresentativo.
  -- st_dwithin in GRADI e non in geography: il cast a geography impedisce
  -- l'uso dell'indice GiST, e la funzione passava da secondi a oltre dieci
  -- minuti perché scansionava tutte le 8.325 fermate per ogni via.
  -- 0,0073 gradi valgono 600-810 metri alla latitudine di Roma: generoso, ma
  -- è un riferimento indicativo, non una misura.
  ancorate as (
    select i.name, i.cn, i.g, i.highway, i.len_totale,
           rif.name as rif_nome, rif.geom as rif_geom
    from intere i
    left join lateral (
      select s.name, s.geom
      from stops s
      where st_dwithin(s.geom, i.g, 0.0073)
      order by s.geom <-> i.g
      limit 1
    ) rif on true
  ),
  punti as (
    select a.*,
           -- Ancorare alla fermata invece che al centro geometrico è ciò che
           -- risolve il difetto originale: il punto di mezzo dell'Appia Nuova
           -- cadeva in un tratto senza servizio e il percorso risultava
           -- impossibile. Senza fermate vicine si ripiega sul centro, e
           -- ClosestPoint garantisce comunque un punto SULLA via, che il
           -- centroide di una via curva non sarebbe.
           coalesce(st_closestpoint(a.g, a.rif_geom),
                    st_closestpoint(a.g, st_centroid(a.g))) as punto
    from ancorate a
  )
  select 'street:' || md5(p.name) || ':' || p.cn,
         'street', p.name, p.name,
         p.rif_nome,
         p.punto,
         p.g,
         p.highway,
         round(p.len_totale)::int
           + case p.highway
               when 'motorway'   then 3000
               when 'trunk'      then 2500
               when 'primary'    then 2000
               when 'secondary'  then 1500
               when 'tertiary'   then 800
               when 'pedestrian' then 500
               else 0
             end
  from punti p
  where p.punto is not null;

  -- Civici: "Via del Corso 12". Gli edifici diventano il loro centroide.
  insert into places (id, kind, name, street, housenumber, label, geom)
  select 'address:' || f.id, 'address',
         coalesce(f.street, f.name, f.housenumber), f.street, f.housenumber,
         trim(coalesce(f.street, f.name, '') || ' ' || f.housenumber),
         case when st_geometrytype(f.geom) = 'ST_Point' then f.geom
              else st_centroid(f.geom) end
  from stg_osm_feature f
  where f.kind = 'address' and f.housenumber is not null
    and coalesce(f.street, f.name) is not null
  on conflict (id) do nothing;

  -- Punti di interesse.
  insert into places (id, kind, name, street, housenumber, label, geom)
  select 'poi:' || f.id, 'poi', f.name, f.street, f.housenumber, f.name,
         case when st_geometrytype(f.geom) = 'ST_Point' then f.geom
              else st_centroid(f.geom) end
  from stg_osm_feature f
  where f.kind = 'poi' and f.name is not null
  on conflict (id) do nothing;

  truncate stg_osm_feature;
end $$;

-- La ricerca restituisce anche il riferimento di zona.
drop function if exists search_places(text);
create function search_places(q text)
returns table (id text, kind text, label text, locality text,
               lon double precision, lat double precision)
language sql stable as $$
  with parole as (
    select regexp_replace(w, '[^[:alnum:]]', '', 'g') as w
    from regexp_split_to_table(lower(coalesce(q, '')), '\s+') as w
  ),
  tq as (
    select string_agg(w || ':*', ' & ') as s from parole where w <> ''
  )
  select p.id, p.kind, p.label, p.locality, st_x(p.geom), st_y(p.geom)
  from places p, tq
  where tq.s is not null
    and to_tsvector('simple', p.label) @@ to_tsquery('simple', tq.s)
  order by
    (case p.kind when 'street' then 0 when 'poi' then 1 else 2 end),
    p.importance desc,
    -- A parità di via, prima i tratti che hanno una fermata vicina: sono gli
    -- unici da cui si possa davvero partire.
    (p.locality is not null) desc,
    length(p.label),
    p.label
  limit 25;
$$;
