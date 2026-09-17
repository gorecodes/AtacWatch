"use client";

import { useState, useEffect, useCallback } from "react";
import { BellGlyph } from "./Glyphs";

const STORAGE_KEY = "atw-push-subs";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function storageKey(stopId: string, tripId: string) {
  return `${stopId}::${tripId}`;
}

function loadSubs(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveSubs(subs: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...subs]));
  } catch {}
}

export default function BellButton({
  stopId,
  tripId,
  routeShortName,
  headsign,
}: {
  stopId: string;
  tripId: string;
  routeShortName: string;
  headsign: string | null;
}) {
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const key = storageKey(stopId, tripId);

  useEffect(() => {
    setSubscribed(loadSubs().has(key));
  }, [key]);

  const toggle = useCallback(async () => {
    if (loading) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    setLoading(true);
    try {
      if (subscribed) {
        // Unsubscribe
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint, stop_id: stopId, trip_id: tripId }),
          });
        }
        const subs = loadSubs();
        subs.delete(key);
        saveSubs(subs);
        setSubscribed(false);
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            stop_id: stopId,
            trip_id: tripId,
            route_short_name: routeShortName,
            headsign,
          }),
        });

        const subs = loadSubs();
        subs.add(key);
        saveSubs(subs);
        setSubscribed(true);
      }
    } catch (e) {
      console.error("[BellButton]", e);
    } finally {
      setLoading(false);
    }
  }, [subscribed, loading, key, stopId, tripId, routeShortName, headsign]);

  // Nasconde il pulsante se il browser non supporta le push (o se non c'è VAPID)
  if (!VAPID_PUBLIC_KEY || typeof window === "undefined") return null;
  if (!("PushManager" in window)) return null;

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
      aria-label={subscribed ? "Rimuovi notifica" : "Avvisami all'arrivo"}
      aria-pressed={subscribed}
      disabled={loading}
      className={`shrink-0 rounded p-1.5 transition-colors ${
        subscribed
          ? "text-brand-500 active:text-brand-700"
          : "text-neutral-400 active:text-neutral-700"
      } ${loading ? "opacity-40" : ""}`}
    >
      <BellGlyph filled={subscribed} className="h-4.5 w-4.5" />
    </button>
  );
}
