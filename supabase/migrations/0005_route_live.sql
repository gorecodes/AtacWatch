-- ============================================================================
-- 0005_route_live.sql — Mezzi in tempo reale di una linea/verso, con la
-- prossima fermata (per mostrarli su mappa e nella lista fermate).
-- ============================================================================

create or replace function route_live(p_route_id text, p_direction_id int)
returns table (
  vehicle_id text,
  lat double precision,
  lon double precision,
  bearing real,
  trip_id text,
  next_stop_id text,
  next_stop_sequence int,
  next_eta_ts timestamptz
)
language sql stable as $$
  select v.vehicle_id, v.lat, v.lon, v.bearing, v.trip_id,
         ns.stop_id, ns.stop_sequence, ns.eta
  from vehicle_positions v
  left join lateral (
    select tu.stop_id, tu.stop_sequence,
           coalesce(tu.arrival_ts, tu.departure_ts) as eta
    from trip_updates tu
    where tu.trip_id = v.trip_id
      and coalesce(tu.arrival_ts, tu.departure_ts) >= now() - interval '1 minute'
    order by coalesce(tu.arrival_ts, tu.departure_ts) asc
    limit 1
  ) ns on true
  where v.route_id = p_route_id
    and (v.direction_id = p_direction_id or v.direction_id is null)
    and v.ts > now() - interval '5 minutes';
$$;
