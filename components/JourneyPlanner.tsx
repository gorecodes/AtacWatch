"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import PlanEndpoint, { type Endpoint } from "./PlanEndpoint";
import ItineraryDetail from "./ItineraryDetail";
import type { PianoItinerario } from "@/lib/itinerario";

/**
 * La richiesta vive NELL'INDIRIZZO, non in memoria.
 *
 * Serve a tre cose che prima non funzionavano: ricaricare la pagina senza
 * perdere il percorso, tornare al percorso dopo essere entrati in una fermata,
 * e mandare un itinerario a qualcuno. Con lo stato in memoria, uscire dalla
 * pagina lo cancellava e si tornava al modulo vuoto.
 *
 * I nomi dei parametri sono gli stessi che vuole /api/plan, così la query per
 * l'API si ricava dall'indirizzo senza tradurre niente. Le etichette servono
 * solo a ridisegnare i due capi: le coordinate da sole non si leggono.
 */
function queryApi(sp: ReadonlyURLSearchParams): string | null {
  const p = new URLSearchParams();
  const copia = (k: string) => {
    const v = sp.get(k);
    if (v) p.set(k, v);
  };
  ["fromStopId", "fromLat", "fromLon", "toStopId", "toLat", "toLon", "at"].forEach(copia);
  const haPartenza = p.has("fromStopId") || (p.has("fromLat") && p.has("fromLon"));
  const haArrivo = p.has("toStopId") || (p.has("toLat") && p.has("toLon"));
  return haPartenza && haArrivo ? p.toString() : null;
}

/** Indirizzo della pagina: come la query dell'API, più le etichette da mostrare. */
function queryPagina(from: Endpoint, to: Endpoint, quando: string): string {
  const p = new URLSearchParams();
  // Il valore di datetime-local è nell'ora locale del telefono, che per chi
  // usa quest'app è quella di Roma: convertirlo in ISO basta.
  if (quando) {
    const t = new Date(quando);
    if (!Number.isNaN(t.getTime())) p.set("at", t.toISOString());
  }
  if (from.kind === "stop") p.set("fromStopId", from.stopId);
  else {
    p.set("fromLat", String(from.lat));
    p.set("fromLon", String(from.lon));
  }
  p.set("fromLabel", from.kind === "gps" ? "La mia posizione" : from.name);
  if (to.kind === "stop") p.set("toStopId", to.stopId);
  else {
    p.set("toLat", String(to.lat));
    p.set("toLon", String(to.lon));
  }
  p.set("toLabel", to.kind === "gps" ? "La mia posizione" : to.name);
  return p.toString();
}

/**
 * Numero da un parametro, o null.
 *
 * Il controllo sul valore grezzo è indispensabile: `Number(null)` vale ZERO e
 * `Number.isFinite(0)` è vero, quindi convertendo direttamente un parametro
 * assente si otteneva la coordinata 0,0. Apparivano due capi chiamati
 * "Posizione scelta" su una pagina appena aperta.
 */
function numeroParam(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function capoDaParams(sp: ReadonlyURLSearchParams, lato: "from" | "to"): Endpoint | null {
  const etichetta = sp.get(`${lato}Label`) ?? "";
  const stopId = sp.get(`${lato}StopId`);
  if (stopId) return { kind: "stop", stopId, name: etichetta || stopId };
  const lat = numeroParam(sp.get(`${lato}Lat`));
  const lon = numeroParam(sp.get(`${lato}Lon`));
  if (lat !== null && lon !== null) {
    return { kind: "place", lat, lon, name: etichetta || "Posizione scelta" };
  }
  return null;
}

export default function JourneyPlanner() {
  const router = useRouter();
  const sp = useSearchParams();

  // I due capi si inizializzano dall'indirizzo: ricaricando, il modulo resta
  // compilato invece di svuotarsi.
  const [from, setFrom] = useState<Endpoint | null>(() => capoDaParams(sp, "from"));
  const [to, setTo] = useState<Endpoint | null>(() => capoDaParams(sp, "to"));
  const [quando, setQuando] = useState(() => {
    const at = sp.get("at");
    if (!at) return "";
    const t = new Date(at);
    if (Number.isNaN(t.getTime())) return "";
    return new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  const [plan, setPlan] = useState<PianoItinerario | null>(null);
  const [errore, setErrore] = useState<"vuoto" | "guasto" | null>(null);
  /** Query già interrogata: evita di rifare la richiesta a ogni ridisegno. */
  const [caricata, setCaricata] = useState<string | null>(null);

  const query = queryApi(sp);
  // Lo stato di caricamento si DEDUCE invece di essere impostato: così non
  // serve un setState sincrono dentro l'effetto, che React sconsiglia.
  const caricando = query !== null && query !== caricata && errore === null;

  useEffect(() => {
    if (!query || query === caricata) return;
    let annullato = false;
    (async () => {
      try {
        const res = await fetch(`/api/plan?${query}`, { cache: "no-store" });
        if (annullato) return;
        if (res.status === 404) {
          setPlan(null);
          setErrore("vuoto");
        } else if (!res.ok) {
          setErrore("guasto");
        } else {
          setPlan(await res.json());
          setErrore(null);
        }
      } catch {
        if (!annullato) setErrore("guasto");
      } finally {
        if (!annullato) setCaricata(query);
      }
    })();
    return () => {
      annullato = true;
    };
  }, [query, caricata]);

  /** L'itinerario aperto: indice nell'indirizzo, così il tasto indietro torna all'elenco. */
  const selRaw = sp.get("sel");
  const sel = selRaw === null ? null : Number(selRaw);
  const aperta =
    plan && sel !== null && Number.isInteger(sel) && sel >= 0 && sel < plan.options.length
      ? plan.options[sel]
      : null;

  function cerca() {
    if (!from || !to) return;
    // Non si interroga qui: si cambia l'indirizzo, e ci pensa l'effetto. Così
    // esiste un solo percorso di codice che carica, e la cronologia funziona.
    setErrore(null);
    router.push(`/plan?${queryPagina(from, to, quando)}`);
  }


  if (aperta) {
    return (
      <ItineraryDetail
        opzione={aperta}
        walkOption={plan!.walkOption}
        onBack={() => router.back()}
      />
    );
  }

  return (
    <div>
      <PlanEndpoint label="Da" value={from} onChange={setFrom} allowGps />
      <PlanEndpoint label="A" value={to} onChange={setTo} allowGps={false} />

      {/* L'orario conta: una linea che a quell'ora non passa non viene
          proposta, quindi pianificare per dopo dà risultati diversi. */}
      <div className="flex items-center gap-2 border-b border-neutral-300 py-2.5">
        <span className="w-[68px] shrink-0 text-[12px] uppercase tracking-wide text-neutral-500">
          Parti
        </span>
        {quando === "" ? (
          <>
            <span className="flex-1 text-[15px] text-neutral-900">Adesso</span>
            <button
              onClick={() => {
                // Precompilo con l'ora attuale: un campo vuoto costringerebbe
                // a digitare tutto da zero.
                const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
                setQuando(d.toISOString().slice(0, 16));
              }}
              className="shrink-0 text-[13px] text-neutral-600 underline underline-offset-2 active:text-neutral-900"
            >
              Scegli l&apos;ora
            </button>
          </>
        ) : (
          <>
            <input
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 focus:outline-none"
            />
            <button
              onClick={() => setQuando("")}
              className="shrink-0 text-[13px] text-neutral-600 underline underline-offset-2 active:text-neutral-900"
            >
              Adesso
            </button>
          </>
        )}
      </div>

      <button
        onClick={cerca}
        disabled={!from || !to || caricando}
        className="mt-4 w-full rounded bg-neutral-900 py-2.5 text-[15px] font-semibold text-neutral-50 disabled:bg-neutral-300"
      >
        {caricando ? "Calcolo…" : "Cerca il percorso"}
      </button>

      {errore === "vuoto" && (
        <p className="py-6 text-[14px] text-neutral-600">
          Nessun percorso trovato. Può capitare di notte, o se uno dei due capi è
          troppo lontano da qualsiasi fermata.
        </p>
      )}
      {errore === "guasto" && (
        <p className="py-6 text-[14px] text-neutral-600">
          Non riesco a calcolare il percorso.{" "}
          <button onClick={cerca} className="font-medium text-brand-600 underline underline-offset-2">
            Riprova
          </button>
        </p>
      )}

      {plan && plan.options.length > 0 && (
        <section className="mt-5">
          {/* Le proposte si mostrano tutte con i loro numeri, e sceglie chi
              legge: non esiste un itinerario giusto in assoluto, perché chi ha
              fretta, chi non vuole cambiare e chi non vuole camminare ne
              vogliono tre diversi. */}
          <h2 className="mb-1 text-[13px] font-semibold text-neutral-500">
            {plan.options.length === 1 ? "Un percorso" : `${plan.options.length} percorsi`}
          </h2>
          <ul className="divide-y divide-neutral-200 border-y border-neutral-300">
            {plan.options.map((o, i) => (
              <li key={i}>
                <button
                  onClick={() => router.push(`/plan?${queryPagina(from!, to!, quando)}&sel=${i}`, { scroll: true })}
                  className="flex w-full items-center gap-3 py-3 text-left active:bg-neutral-200/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] tabular-nums text-neutral-900">
                      <span className="font-semibold">{o.durationMin} min</span>
                      <span className="text-neutral-500"> di viaggio</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-neutral-600">
                      {o.lines.length > 0 ? o.lines.join(" › ") : "tutto a piedi"}
                      {o.rides > 1 && ` · ${o.rides - 1} camb${o.rides === 2 ? "io" : "i"}`}
                      {o.walkMin > 0 && ` · ${o.walkMin} min a piedi`}
                    </span>
                  </span>
                  <span className="shrink-0 text-neutral-300">›</span>
                </button>
              </li>
            ))}
          </ul>

          {plan.walkOption && (
            <p className="mt-3 text-[13px] text-neutral-600">
              Oppure <span className="font-semibold text-neutral-900">tutto a piedi</span> in{" "}
              {plan.walkOption.minutes} min ({(plan.walkOption.meters / 1000).toFixed(1)} km).
            </p>
          )}
        </section>
      )}
    </div>
  );
}
