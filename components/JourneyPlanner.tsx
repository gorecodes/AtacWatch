"use client";

import { useState } from "react";
import Link from "next/link";
import RouteBadge from "./RouteBadge";
import PlanEndpoint, { type Endpoint } from "./PlanEndpoint";

type Fermata = { stopId: string; name: string; code: string | null };
type Leg =
  | { kind: "walk"; from: Fermata | null; to: Fermata | null; minutes: number; meters?: number }
  | {
      kind: "ride";
      tripId: string;
      shortName: string;
      color: string | null;
      textColor: string | null;
      headsign: string | null;
      from: Fermata;
      to: Fermata;
      departAt: string;
      arriveAt: string;
      minutes: number;
    };
type Plan = {
  departAt: string;
  arriveAt: string;
  durationMin: number;
  walkMin: number;
  legs: Leg[];
  walkOption: { minutes: number; meters: number } | null;
};

function ora(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });
}

function params(from: Endpoint, to: Endpoint): string {
  const p = new URLSearchParams();
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
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");

  async function cerca() {
    if (!from || !to) return;
    setState("loading");
    setPlan(null);
    try {
      const res = await fetch(`/api/plan?${params(from, to)}`, { cache: "no-store" });
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

  return (
    <div>
      <PlanEndpoint label="Da" value={from} onChange={setFrom} allowGps />
      <PlanEndpoint label="A" value={to} onChange={setTo} allowGps={false} />

      <button
        onClick={cerca}
        disabled={!from || !to || state === "loading"}
        className="mt-4 w-full rounded bg-neutral-900 py-2.5 text-[15px] font-semibold text-white disabled:bg-neutral-300"
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

      {plan && (
        <section className="mt-5">
          <div className="flex items-baseline justify-between border-b border-neutral-300 pb-2">
            <p className="text-[19px] font-bold tabular-nums text-neutral-900">
              {ora(plan.departAt)} → {ora(plan.arriveAt)}
            </p>
            <p className="text-[13px] text-neutral-600">
              {plan.durationMin} min · {plan.walkMin} a piedi
            </p>
          </div>

          <ol className="divide-y divide-neutral-200">
            {plan.legs.map((leg, i) => (
              <li key={i} className="flex gap-3 py-3">
                {leg.kind === "walk" ? (
                  <>
                    <span className="w-[52px] shrink-0 text-[12px] uppercase tracking-wide text-neutral-500">
                      a piedi
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] leading-snug text-neutral-700">
                      {leg.minutes} min
                      {leg.to ? (
                        <>
                          {" "}fino a <span className="name text-neutral-900">{leg.to.name}</span>
                        </>
                      ) : leg.from ? (
                        <>
                          {" "}da <span className="name text-neutral-900">{leg.from.name}</span> a destinazione
                        </>
                      ) : (
                        " fino a destinazione"
                      )}
                      {leg.meters != null && <span className="text-neutral-500"> ({leg.meters} m)</span>}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-[52px] shrink-0">
                      <RouteBadge
                        shortName={leg.shortName}
                        color={leg.color}
                        textColor={leg.textColor}
                        size="sm"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="name block truncate text-[14px] font-medium text-neutral-900">
                        {leg.headsign ?? "Destinazione non indicata"}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-neutral-600">
                        <Link
                          href={`/stop/${encodeURIComponent(leg.from.stopId)}`}
                          className="underline decoration-neutral-300 underline-offset-2"
                        >
                          {leg.from.name}
                        </Link>{" "}
                        <span className="tabular-nums text-neutral-900">{ora(leg.departAt)}</span>
                        {" → "}
                        <Link
                          href={`/stop/${encodeURIComponent(leg.to.stopId)}`}
                          className="underline decoration-neutral-300 underline-offset-2"
                        >
                          {leg.to.name}
                        </Link>{" "}
                        <span className="tabular-nums text-neutral-900">{ora(leg.arriveAt)}</span>
                      </span>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>

          {plan.walkOption && (
            <p className="border-t border-neutral-200 pt-3 text-[13px] text-neutral-600">
              Oppure <span className="font-semibold text-neutral-900">tutto a piedi</span> in{" "}
              {plan.walkOption.minutes} min ({(plan.walkOption.meters / 1000).toFixed(1)} km in linea
              d&apos;aria)
              {plan.walkOption.minutes < plan.durationMin && ", che è più rapido"}.
            </p>
          )}

          <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
            Orari da tabella, senza il tempo reale: un mezzo in ritardo cambia le
            coincidenze. Le distanze a piedi sono in linea d&apos;aria.
          </p>
        </section>
      )}
    </div>
  );
}
