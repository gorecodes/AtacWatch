import { useEffect, useRef, useState } from "react";

/**
 * Restituisce un timestamp (ms) che si aggiorna ogni `ms`, così i conteggi
 * "tra N min" derivati da un istante assoluto restano vivi tra un refresh dati
 * e l'altro. Si ferma quando la tab è in background (come usePolling).
 */
export function useNow(ms: number = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => setNow(Date.now());
    const start = () => {
      if (timer == null) timer = setInterval(tick, ms);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        tick();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
  return now;
}

/**
 * Esegue `fn` subito e poi ogni `ms` millisecondi, ma SOSPENDE il polling
 * quando la pagina è in background (tab nascosta / app in background): evita
 * di consumare batteria e quota API per dati che l'utente non sta guardando.
 * Al ritorno in primo piano rifà subito un giro e riprende l'intervallo.
 */
export function usePolling(fn: () => void, ms: number, deps: unknown[]) {
  const saved = useRef(fn);
  // Tiene il ref allineato alla callback più recente senza scriverlo in render.
  useEffect(() => {
    saved.current = fn;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer == null) timer = setInterval(() => saved.current(), ms);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        saved.current();
        start();
      }
    };

    if (!document.hidden) {
      saved.current();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
