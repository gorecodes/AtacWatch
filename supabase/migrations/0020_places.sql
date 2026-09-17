-- ============================================================================
-- 0020_places.sql — Geocoding: vie, civici e punti di interesse di Roma.
--
-- Serve per cercare un percorso "da via a via": spesso si conosce la via, non
-- il nome della fermata. I dati vengono da OpenStreetMap (vedi
-- scripts/osm-extract.sh) e restano in casa: nessuna chiave API, nessun limite
-- di richieste, e la ricerca è testuale come quella delle fermate, quindi
-- riusa gli indici che in questo schema funzionano già.
--
-- LE STRADE VANNO AGGREGATE. In OSM una via è spezzata in decine di segmenti:
-- i 66.333 segmenti con nome dell'estratto di Roma corrispondono a qualche
-- migliaio di vie reali, e cercando "Via del Corso" non deve comparire
-- quaranta volte. Si raggruppa per nome con un clustering spaziale a ~300m,
-- così i pezzi contigui diventano una via sola ma due "Via Roma" in quartieri
-- diversi restano due voci distinte.
--
-- Il punto rappresentativo è ST_ClosestPoint(geometria, centroide): il
-- centroide di una via curva può cadere fuori dalla strada, questo invece è
-- sempre un punto SULLA via, vicino alla metà.
--
-- Si conserva anche la geometria completa (shape): per le vie molto lunghe il
-- punto di mezzo è imprecisissimo, e avere la linea permetterà di risolvere
-- l'indirizzo nel punto più vicino all'altro capo del viaggio.
--
-- Civici e punti di interesse possono riferirsi allo stesso oggetto OSM (un
-- albergo ha un nome E un indirizzo): l'id è prefissato dal tipo così
-- l'albergo è trovabile sia per nome sia per via e civico.
-- ============================================================================

create table if not exists places (
  id          text not null primary key,
  kind        text not null check (kind in ('street', 'address', 'poi')),
  name        text not null,
  street      text,
  housenumber text,
  /** Testo mostrato e su cui si cerca. */
  label       text not null,
  /** Punto rappresentativo, sempre valorizzato. */
  geom        geometry(Point, 4326) not null,
  /** Geometria completa: valorizzata per le vie, utile per i raffinamenti. */
  shape       geometry(Geometry, 4326)
);

create index if not exists places_label_trgm on places using gin (label gin_trgm_ops);
create index if not exists places_geom_idx    on places using gist (geom);
create index if not exists places_kind_idx    on places (kind);

-- Staging caricata dal loader (lib/ingest-osm.ts), poi aggregata qui.
create table if not exists stg_osm_feature (
  id          text,
  kind        text,
  name        text,
  street      text,
  housenumber text,
  geom        geometry(Geometry, 4326)
);

create or replace function rebuild_places_from_staging() returns void
language plpgsql as $$
begin
  truncate places;

  -- Vie: clustering per nome, poi fusione dei segmenti contigui.
  -- 0,003 gradi valgono circa 250-330 metri alla latitudine di Roma.
  insert into places (id, kind, name, label, geom, shape)
  select 'street:' || md5(c.name) || ':' || c.n,
         'street', c.name, c.name,
         st_closestpoint(c.g, st_centroid(c.g)),
         c.g
  from (
    select name,
           row_number() over (partition by name) as n,
           st_linemerge(st_collectionextract(cluster_geom, 2)) as g
    from (
      select name, unnest(st_clusterwithin(geom, 0.003)) as cluster_geom
      from stg_osm_feature
      where kind = 'street' and name is not null
      group by name
    ) k
  ) c
  where c.g is not null and not st_isempty(c.g);

  -- Civici: "Via del Corso 12". Le geometrie non puntuali (edifici) diventano
  -- il loro centroide.
  insert into places (id, kind, name, street, housenumber, label, geom)
  select 'address:' || f.id,
         'address',
         coalesce(f.street, f.name, f.housenumber),
         f.street,
         f.housenumber,
         trim(coalesce(f.street, f.name, '') || ' ' || f.housenumber),
         case when st_geometrytype(f.geom) = 'ST_Point' then f.geom
              else st_centroid(f.geom) end
  from stg_osm_feature f
  where f.kind = 'address'
    and f.housenumber is not null
    and coalesce(f.street, f.name) is not null
  on conflict (id) do nothing;

  -- Punti di interesse.
  insert into places (id, kind, name, street, housenumber, label, geom)
  select 'poi:' || f.id,
         'poi', f.name, f.street, f.housenumber, f.name,
         case when st_geometrytype(f.geom) = 'ST_Point' then f.geom
              else st_centroid(f.geom) end
  from stg_osm_feature f
  where f.kind = 'poi' and f.name is not null
  on conflict (id) do nothing;

  truncate stg_osm_feature;
end $$;

-- Ricerca unificata. Segue lo spirito di search_stops (0008): ilike servito
-- dall'indice trigram, con un ordinamento che mette prima le corrispondenze
-- dall'inizio del nome e i testi più corti, che sono quelli più generali.
create or replace function search_places(q text)
returns table (id text, kind text, label text, lon double precision, lat double precision)
language sql stable as $$
  select p.id, p.kind, p.label, st_x(p.geom), st_y(p.geom)
  from places p
  where p.label ilike '%' || q || '%'
  order by
    -- una via prima di un civico o di un negozio con lo stesso testo
    (case p.kind when 'street' then 0 when 'poi' then 1 else 2 end),
    (p.label ilike q || '%') desc,
    length(p.label),
    p.label
  limit 20;
$$;
