"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlanEndpoint, { type Endpoint } from "./PlanEndpoint";
import ItineraryDetail from "./ItineraryDetail";
import type { PianoItinerario } from "@/lib/itinerario";

function params(from: Endpoint, to: Endpoint, quando: string): string {
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
  if (to.kind === "stop") p.set("toStopId", to.stopId);
  else {
    p.set("toLat", String(to.lat));
    p.set("toLon", String(to.lon));
  }
  return p.toString();
}

export default function JourneyPlanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [plan, setPlan] = useState<PianoItinerario | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  /** Vuoto = parto adesso. */
  const [quando, setQuando] = useState("");

  /**
   * L'itinerario aperto sta nell'INDIRIZZO e non in uno stato interno, così il
   * tasto indietro del browser — che su Android è il gesto di sistema — riporta
   * all'elenco invece di uscire dall'app.
   */
  const selRaw = searchParams.get("sel");
  const sel = selRaw === null ? null : Number(selRaw);
  const aperta =
    plan && sel !== null && Number.isInteger(sel) && sel >= 0 && sel < plan.options.length
      ? plan.options[sel]
      : null;

  async function cerca() {
    if (!from || !to) return;
    setState("loading");
    setPlan(null);
    try {
      const res = await fetch(`/api/plan?${params(from, to, quando)}`, { cache: "no-store" });
      if (res.status === 404) {
        setState("empty");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPlan(await res.json());
      setState("idle");
    } catch {
      setState("error");
    }
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
        disabled={!from || !to || state === "loading"}
        className="mt-4 w-full rounded bg-neutral-900 py-2.5 text-[15px] font-semibold text-neutral-50 disabled:bg-neutral-300"
      >
        {state === "loading" ? "Calcolo…" : "Cerca il percorso"}
      </button>

      {state === "empty" && (
        <p className="py-6 text-[14px] text-neutral-600">
          Nessun percorso trovato. Può capitare di notte, o se uno dei due capi è
          troppo lontano da qualsiasi fermata.
        </p>
      )}
      {state === "error" && (
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
                  onClick={() => router.push(`/plan?sel=${i}`, { scroll: true })}
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
