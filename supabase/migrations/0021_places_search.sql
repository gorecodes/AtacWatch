-- ============================================================================
-- 0021_places_search.sql — Ricerca dei luoghi: parole e importanza.
--
-- 0020 cercava per sottostringa, come fa search_stops, e su indirizzi non
-- funziona. Due difetti trovati provando:
--
-- 1. "Viale Marconi" non trovava NIENTE, perché la via in OSM si chiama
--    "Viale Guglielmo Marconi" e `label ilike '%viale marconi%'` non aggancia
--    parole separate. Sui nomi di fermata la sottostringa bastava, sugli
--    indirizzi no: nessuno digita il secondo nome di battesimo.
--
-- 2. Cercando "Via del Corso" il primo risultato era la via omonima ad Acilia
--    invece di quella in centro, perché a parità di testo non c'era alcun
--    criterio. Due punti periferici scelti così davano "nessun itinerario".
--
-- Soluzione al primo: full-text con prefisso su ogni parola, così "viale marc"
-- aggancia "Viale Guglielmo Marconi" mentre si digita e l'ordine delle parole
-- non conta.
--
-- Soluzione al secondo: una colonna `importance`. Per le vie è la lunghezza in
-- metri, che è un indicatore grezzo ma efficace di quanto una strada sia
-- principale — la Via del Corso vera è più lunga della sua omonima di
-- periferia, e le consolari lo sono di molto. Si somma un bonus per la classe
-- OSM della strada, perché una `primary` conta più di una `residential`.
-- ============================================================================

alter table places add column if not exists importance integer not null default 0;
alter table places add column if not exists highway    text;

-- La classe stradale deve arrivare dal loader, quindi serve anche in staging.
alter table stg_osm_feature add column if not exists highway text;

create index if not exists places_label_fts
  on places using gin (to_tsvector('simple', label));

-- Rigenera places dalla staging. Come 0020 più importanza e classe stradale.
create or replace function rebuild_places_from_staging() returns void
language plpgsql as $$
begin
  truncate places;

  -- Vie: clustering per nome (0,003 gradi ≈ 250-330 m alla latitudine di Roma),
  -- poi fusione dei segmenti contigui. Due "Via Roma" in quartieri diversi
  -- restano due voci: verificato che i due "Via del Corso" distano 14,5 km.
  insert into places (id, kind, name, label, geom, shape, highway, importance)
  select 'street:' || md5(c.name) || ':' || c.n,
         'street', c.name, c.name,
         -- Il centroide di una via curva può cadere fuori dalla strada:
         -- ClosestPoint restituisce sempre un punto SULLA via.
         st_closestpoint(c.g, st_centroid(c.g)),
         c.g,
         c.highway,
         round(st_length(c.g::geography))::int
           + case c.highway
               when 'motorway'   then 3000
               when 'trunk'      then 2500
               when 'primary'    then 2000
               when 'secondary'  then 1500
               when 'tertiary'   then 800
               when 'pedestrian' then 500
               else 0
             end
  from (
    select name,
           row_number() over (partition by name) as n,
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
  ) c
  where c.g is not null and not st_isempty(c.g);

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

create or replace function search_places(q text)
returns table (id text, kind text, label text, lon double precision, lat double precision)
language sql stable as $$
  with parole as (
    -- I caratteri non alfanumerici vanno via: to_tsquery altrimenti solleva
    -- errore su un apostrofo o una virgola digitati per caso.
    select regexp_replace(w, '[^[:alnum:]]', '', 'g') as w
    from regexp_split_to_table(lower(coalesce(q, '')), '\s+') as w
  ),
  tq as (
    -- ':*' su ogni parola: aggancia i prefissi mentre si digita, e '&' impone
    -- che ci siano tutte, in qualunque ordine.
    select string_agg(w || ':*', ' & ') as s from parole where w <> ''
  )
  select p.id, p.kind, p.label, st_x(p.geom), st_y(p.geom)
  from places p, tq
  where tq.s is not null
    and to_tsvector('simple', p.label) @@ to_tsquery('simple', tq.s)
  order by
    (case p.kind when 'street' then 0 when 'poi' then 1 else 2 end),
    p.importance desc,
    length(p.label),
    p.label
  limit 20;
$$;
