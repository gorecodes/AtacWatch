"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyle, ROME_CENTER } from "@/lib/mapStyle";

type Stop = { stop_id: string; name: string; lon: number; lat: number };
export type LiveVehicle = { vehicle_id: string; lon: number; lat: number; bearing: number | null };

// Triangolo scuro che punta a nord (ruotato poi via icon-rotate sul bearing).
// Generato a runtime così non dipende da font/sprite dello stile.
function triangleImageData(): ImageData | null {
  const s = 18;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#10141A";
  ctx.beginPath();
  ctx.moveTo(s / 2, 2);
  ctx.lineTo(s - 3, s - 4);
  ctx.lineTo(3, s - 4);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}

export default function RouteMap({
  shape,
  stops,
  vehicles = [],
  color,
}: {
  shape: GeoJSON.LineString | null;
  stops: Stop[];
  vehicles?: LiveVehicle[];
  color?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vehiclesRef = useRef<LiveVehicle[]>(vehicles);
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const fittedRef = useRef(false);
  // Stile pronto? L'handler viene agganciato alla creazione della mappa, dove
  // è impossibile perdere l'evento, e il risultato passa per lo stato React
  // così l'effect di disegno riparte da solo quando la mappa è utilizzabile.
  const [ready, setReady] = useState(false);

  /**
   * Inquadra il tracciato, ma solo quando il contenitore ha una dimensione
   * reale: al primo disegno può ancora essere alto 0 (import dinamico +
   * idratazione), e un fitBounds su un viewport 0×0 dà uno zoom senza senso.
   * Una volta riuscito non reinquadra più, così non combatte con chi trascina.
   */
  function fitStoredBounds() {
    const map = mapRef.current;
    const el = containerRef.current;
    const b = boundsRef.current;
    if (!map || !el || !b) return;
    if (el.clientWidth === 0 || el.clientHeight === 0) return;
    map.resize();
    map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
    fittedRef.current = true;
  }

  function vehicleData(list: LiveVehicle[]): GeoJSON.FeatureCollection {
    return {
      type: "FeatureCollection",
      features: list.map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        properties: { id: v.vehicle_id, bearing: v.bearing ?? 0 },
      })),
    };
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: ROME_CENTER,
      zoom: 11,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (map.isStyleLoaded()) setReady(true);
    else map.on("load", () => setReady(true));

    // Quando il contenitore passa da altezza 0 alla sua misura vera, riprova
    // l'inquadratura: è il caso in cui il fit iniziale non poteva riuscire.
    const ro = new ResizeObserver(() => {
      if (!fittedRef.current) fitStoredBounds();
      else map.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Tracciato + fermate (ricentra solo quando cambiano shape/stops)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Le linee bus non hanno colore nel GTFS: restano basalto, e il colore
    // se c'è è quello ufficiale della metro.
    const lineColor = color ? `#${color.replace("#", "")}` : "#1B2027";

    const draw = () => {
      if (shape) {
        const data: GeoJSON.Feature = { type: "Feature", geometry: shape, properties: {} };
        const src = map.getSource("route-line") as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else {
          map.addSource("route-line", { type: "geojson", data });
          map.addLayer({
            id: "route-line",
            type: "line",
            source: "route-line",
            paint: { "line-color": lineColor, "line-width": 4, "line-opacity": 0.85 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
      }

      const stopData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: stops.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: { id: s.stop_id, name: s.name },
        })),
      };
      const ssrc = map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined;
      if (ssrc) ssrc.setData(stopData);
      else {
        map.addSource("route-stops", { type: "geojson", data: stopData });
        map.addLayer({
          id: "route-stops",
          type: "circle",
          source: "route-stops",
          paint: {
            "circle-radius": 4,
            "circle-color": "#ffffff",
            "circle-stroke-color": lineColor,
            "circle-stroke-width": 2,
          },
        });
      }

      // Sorgente mezzi (creata una volta, aggiornata dall'altro effect)
      if (!map.getSource("route-vehicles")) {
        map.addSource("route-vehicles", { type: "geojson", data: vehicleData(vehiclesRef.current) });
        map.addLayer({
          id: "route-vehicles-dot",
          type: "circle",
          source: "route-vehicles",
          paint: {
            "circle-radius": 8,
            "circle-color": "#00875A",
            "circle-stroke-color": "#10141A",
            "circle-stroke-width": 2,
          },
        });
        if (!map.hasImage("veh-arrow")) {
          const img = triangleImageData();
          if (img) map.addImage("veh-arrow", img);
        }
        map.addLayer({
          id: "route-vehicles-arrow",
          type: "symbol",
          source: "route-vehicles",
          layout: {
            "icon-image": "veh-arrow",
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-size": 0.9,
          },
        });
      }

      const coords: [number, number][] = [];
      if (shape) shape.coordinates.forEach((c) => coords.push([c[0], c[1]]));
      stops.forEach((s) => coords.push([s.lon, s.lat]));
      if (coords.length) {
        boundsRef.current = coords.reduce(
          (acc, c) => acc.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        fittedRef.current = false;
        fitStoredBounds();
      }
    };

    // Nessuna attesa di eventi qui: ci arriviamo solo con `ready` true, quindi
    // la mappa è già utilizzabile e si disegna subito. Aspettare un evento
    // dentro questo effect era la causa della mappa vuota al primo
    // caricamento: l'handler registrato al mount veniva rimosso dal cleanup
    // quando arrivavano i dati, e l'evento non tornava più.
    draw();
  }, [ready, shape, stops, color]);

  // Aggiorna solo i mezzi (senza ricentrare)
  useEffect(() => {
    vehiclesRef.current = vehicles;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("route-vehicles") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(vehicleData(vehicles));
  }, [vehicles]);

  return <div ref={containerRef} className="h-full w-full" />;
}
