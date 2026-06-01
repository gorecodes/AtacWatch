"use client";

import { useEffect, useRef } from "react";
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
  ctx.fillStyle = "#06281d";
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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Tracciato + fermate (ricentra solo quando cambiano shape/stops)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lineColor = color ? `#${color.replace("#", "")}` : "#38bdf8";

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
            "circle-color": "#10b981",
            "circle-stroke-color": "#06281d",
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
        const b = coords.reduce(
          (acc, c) => acc.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        map.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [shape, stops, color]);

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
