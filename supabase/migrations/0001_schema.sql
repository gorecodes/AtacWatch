-- ============================================================================
-- 0001_schema.sql — Estensioni, tabelle statiche, realtime, staging, RLS
-- ============================================================================

create extension if not exists postgis;

-- ----------------------------------------------------------------------------
-- Tabelle STATICHE (popolate dall'ETL giornaliero a partire dalle staging)
-- ----------------------------------------------------------------------------

create table if not exists routes (
  route_id    text primary key,
  agency_id   text,
  short_name  text not null,
  long_name   text,
  type        smallint not null default 3,
  color       text,
  text_color  text
);
create index if not exists routes_short_name_idx on routes (lower(short_name));

create table if not exists stops (
  stop_id  text primary key,
  code     text,
  name     text not null,
  geom     geometry(Point, 4326) not null
);
create index if not exists stops_geom_idx on stops using gist (geom);
create index if not exists stops_name_idx on stops using gin (to_tsvector('simple', name));

-- Elenco ordinato delle fermate di una linea per verso (trip rappresentativo)
create table if not exists route_stops (
  route_id      text not null,
  direction_id  smallint not null,
  stop_sequence int not null,
  stop_id       text not null,
  headsign      text,
  primary key (route_id, direction_id, stop_sequence)
);
create index if not exists route_stops_stop_idx on route_stops (stop_id);

-- Tracciato (polilinea) della linea per verso
create table if not exists route_shapes (
  route_id      text not null,
  direction_id  smallint not null,
  geom          geometry(LineString, 4326) not null,
  primary key (route_id, direction_id)
);

-- OPZIONE C: orari compressi. Una riga per (fermata, linea, verso, servizio)
-- con array di orari di partenza in secondi-da-mezzanotte (ordinati).
create table if not exists stop_schedule (
  stop_id      text not null,
  route_id     text not null,
  direction_id smallint not null,
  service_id   text not null,
  headsign     text,
  departures   int[] not null,
  primary key (stop_id, route_id, direction_id, service_id)
);
create index if not exists stop_schedule_stop_idx on stop_schedule (stop_id);

create table if not exists calendar (
  service_id text primary key,
  monday boolean, tuesday boolean, wednesday boolean, thursday boolean,
  friday boolean, saturday boolean, sunday boolean,
  start_date date, end_date date
);

create table if not exists calendar_dates (
  service_id     text not null,
  date           date not null,
  exception_type smallint not null, -- 1 = aggiunto, 2 = rimosso
  primary key (service_id, date)
);

-- ----------------------------------------------------------------------------
-- Tabelle REALTIME (popolate dalla Edge Function ingest-rt ogni ~60s)
-- ----------------------------------------------------------------------------

create table if not exists vehicle_positions (
  vehicle_id   text primary key,
  trip_id      text,
  route_id     text,
  direction_id smallint,
  lat          double precision not null,
  lon          double precision not null,
  bearing      real,
  speed        real,
  geom         geometry(Point, 4326) generated always as
                 (st_setsrid(st_makepoint(lon, lat), 4326)) stored,
  ts           timestamptz not null,
  updated_at   timestamptz not null default now()
);
create index if not exists vehicle_positions_geom_idx on vehicle_positions using gist (geom);
create index if not exists vehicle_positions_route_idx on vehicle_positions (route_id);
create index if not exists vehicle_positions_ts_idx on vehicle_positions (ts);

create table if not exists trip_updates (
  trip_id       text not null,
  stop_sequence int not null,
  route_id      text,
  stop_id       text,
  arrival_ts    timestamptz,
  departure_ts  timestamptz,
  delay         int,
  updated_at    timestamptz not null default now(),
  primary key (trip_id, stop_sequence)
);
create index if not exists trip_updates_stop_idx on trip_updates (stop_id);

create table if not exists service_alerts (
  id          text primary key,
  header      text,
  description text,
  cause       text,
  effect      text,
  route_ids   text[],
  stop_ids    text[],
  start_ts    timestamptz,
  end_ts      timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists feed_meta (
  feed          text primary key,
  last_fetch    timestamptz,
  last_modified text,
  entity_count  int
);

-- ----------------------------------------------------------------------------
-- Tabelle STAGING (grezze GTFS, popolate a batch dall'ETL e poi aggregate).
-- Vengono troncate a fine ETL: non pesano sul free tier a regime.
-- ----------------------------------------------------------------------------

create table if not exists stg_routes (
  route_id text, agency_id text, route_short_name text, route_long_name text,
  route_type smallint, route_color text, route_text_color text
);
create table if not exists stg_stops (
  stop_id text, stop_code text, stop_name text, stop_lat double precision, stop_lon double precision
);
create table if not exists stg_trips (
  trip_id text, route_id text, service_id text, trip_headsign text,
  direction_id smallint, shape_id text
);
create table if not exists stg_stop_times (
  trip_id text, stop_id text, stop_sequence int, departure_s int
);
create table if not exists stg_shapes (
  shape_id text, lat double precision, lon double precision, seq int
);
create table if not exists stg_calendar (
  service_id text, monday boolean, tuesday boolean, wednesday boolean, thursday boolean,
  friday boolean, saturday boolean, sunday boolean, start_date date, end_date date
);
create table if not exists stg_calendar_dates (
  service_id text, date date, exception_type smallint
);

-- ----------------------------------------------------------------------------
-- RLS: lettura pubblica su tutte le tabelle di dominio. Le scritture passano
-- solo dal service_role (ETL/cron), che bypassa RLS.
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'routes','stops','route_stops','route_shapes','stop_schedule',
    'calendar','calendar_dates','vehicle_positions','trip_updates',
    'service_alerts','feed_meta'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists %I on %I;', t || '_read', t);
    execute format(
      'create policy %I on %I for select using (true);', t || '_read', t);
  end loop;
end $$;
