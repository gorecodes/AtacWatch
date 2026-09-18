"use client";

import { useState, useEffect, useCallback } from "react";
import { BellGlyph } from "./Glyphs";
import { tocco } from "@/lib/tocco";

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
  etichetta,
}: {
  stopId: string;
  tripId: string;
  routeShortName: string;
  headsign: string | null;
  /**
   * Nome della fermata: se c'è, il tasto diventa largo e scritto invece di un
   * glifo solo. Serve sulla pagina della corsa, dove il tasto è uno e deve
   * dire cosa fa — un campanello di venti pixel nessuno lo notava.
   */
  etichetta?: string;
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
        tocco();
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
        // Doppio: la notifica è attiva, ed è la conferma che conta di più.
        tocco("doppio");
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

  if (etichetta) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        aria-pressed={subscribed}
        disabled={loading}
        className={`flex w-full items-center justify-center gap-2 rounded border py-2.5 text-[14px] font-semibold transition-colors ${
          subscribed
            ? "border-brand-200 bg-brand-50 text-brand-600"
            : "border-neutral-300 bg-neutral-50 text-neutral-700 active:bg-neutral-200/60"
        } ${loading ? "opacity-40" : ""}`}
      >
        <BellGlyph filled={subscribed} className="h-[18px] w-[18px] shrink-0" />
        <span className="min-w-0 truncate">
          {subscribed ? "Ti avviso a " : "Avvisami a "}
          <span className="name">{etichetta}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
      aria-label={subscribed ? "Rimuovi notifica" : "Avvisami all'arrivo"}
      aria-pressed={subscribed}
      disabled={loading}
      // 44px è il minimo raccomandato per un bersaglio da toccare col dito:
      // prima erano 30, e si sbagliava mira.
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
        subscribed
          ? "text-brand-500 active:bg-brand-50"
          : "text-neutral-400 active:bg-neutral-200/60"
      } ${loading ? "opacity-40" : ""}`}
    >
      <BellGlyph filled={subscribed} className="h-5 w-5" />
    </button>
  );
}
