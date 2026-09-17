import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { loadConnections } from "@/lib/plan/connections";
import { loadFootpaths } from "@/lib/plan/footpaths";
import { findAccess, walkDistance } from "@/lib/plan/access";
import { csaEarliestArrival, type Leg } from "@/lib/plan/csa";
import { walkSeconds, MAX_WALK_ONLY_S, MAX_WALK_ALT_M } from "@/lib/plan/policy";

/**
 * Raggio stretto per l'alternativa "meno cammino": obbliga a salire vicino al
 * punto di partenza invece di raggiungere a piedi una fermata più a monte.
 *
 * Nasce da una segnalazione. Da Via Apiro il router faceva camminare sei
 * minuti fino a SALARIA/CASTEL GIUBILEO per prendere una 334 alle 10:07,
 * mentre una 334 passa da RAPAGNANO/APIRO — sotto casa — alle 10:25. La prima
 * arriva prima, ed è la risposta corretta all'earliest-arrival; la seconda fa
 * camminare cinque minuti in meno. Non c'è una risposta sola giusta, quindi si
 * mostrano entrambe.
 */
const ACCESS_TIGHT_M = 350;

/** Data locale romana dell'istante indicato: decide quali servizi caricare. */
function romeDate(epochMs: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

async function stopCoords(stopId: string): Promise<[number, number] | null> {
  const r = await getSql()<{ lat: number; lon: number }[]>`
    SELECT st_y(geom)::float8 AS lat, st_x(geom)::float8 AS lon
    FROM stops WHERE stop_id = ${stopId}
  `;
  return r[0] ? [r[0].lat, r[0].lon] : null;
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;

  // I due capi si possono dare come coordinate (posizione attuale) o come
  // fermata scelta dalla ricerca, che non restituisce le coordinate.
  let fromLat = num(p.get("fromLat"));
  let fromLon = num(p.get("fromLon"));
  let toLat = num(p.get("toLat"));
  let toLon = num(p.get("toLon"));

  const fromStopId = p.get("fromStopId");
  const toStopId = p.get("toStopId");

  if ((fromLat === null || fromLon === null) && fromStopId) {
    const c = await stopCoords(fromStopId);
    if (c) [fromLat, fromLon] = c;
  }
  if ((toLat === null || toLon === null) && toStopId) {
    const c = await stopCoords(toStopId);
    if (c) [toLat, toLon] = c;
  }

  if (fromLat === null || fromLon === null || toLat === null || toLon === null) {
    return NextResponse.json(
      { error: "serve un punto di partenza e uno di arrivo (coordinate o id fermata)" },
      { status: 400 },
    );
  }

  const atRaw = p.get("at");
  const atMs = atRaw ? Date.parse(atRaw) : Date.now();
  if (!Number.isFinite(atMs)) {
    return NextResponse.json({ error: "parametro at non valido" }, { status: 400 });
  }
  const departEpoch = Math.floor(atMs / 1000);

  try {
    const sql = getSql();
    const dateISO = romeDate(atMs);

    const cs = await loadConnections(sql, dateISO);
    const [fp, access, egress, direttoM] = await Promise.all([
      loadFootpaths(sql, cs, dateISO),
      findAccess(sql, cs, fromLat, fromLon),
      findAccess(sql, cs, toLat, toLon),
      walkDistance(sql, fromLat, fromLon, toLat, toLon),
    ]);

    const soloPiediS = walkSeconds(direttoM);
    const camminabile = direttoM <= MAX_WALK_ALT_M;

    // Raggio stretto: obbliga a salire vicino al punto di partenza invece di
    // raggiungere a piedi una fermata più a monte. Almeno la fermata più
    // vicina resta sempre disponibile, altrimenti in periferia il raggio
    // stretto non ne conterrebbe nessuna.
    const stretto = (l: typeof access) => {
      const v = l.filter((x) => x.meters <= ACCESS_TIGHT_M);
      return v.length > 0 ? v : l.slice(0, 1);
    };

    // Il fronte delle opzioni: una scansione per ogni tetto di cambi, più le
    // varianti a raggio stretto. Non esiste un itinerario "giusto" — chi ha
    // fretta, chi non vuole cambiare e chi non vuole camminare ne vogliono
    // tre diversi — quindi si generano e si mostrano tutti, come fa Google
    // Maps. Ogni scansione costa un paio di millisecondi.
    const risultati =
      access.length > 0 && egress.length > 0
        ? [
            ...[1, 2, 3, 4].map((cap) =>
              csaEarliestArrival(cs, fp, access, egress, departEpoch, cap),
            ),
            ...[1, 2, 3].map((cap) =>
              csaEarliestArrival(cs, fp, stretto(access), stretto(egress), departEpoch, cap),
            ),
          ].filter((r): r is NonNullable<typeof r> => r !== null)
        : [];

    const res = risultati[0] ?? null;

    // Andare a piedi diventa la risposta principale solo se è breve, oppure se
    // non esiste alcun itinerario in mezzo pubblico. Quando il mezzo esiste ma
    // è più lento, resta lui la risposta e il cammino compare come
    // alternativa: chi chiede un percorso vuole vedere il percorso.
    const piediComePrincipale =
      camminabile && (soloPiediS <= MAX_WALK_ONLY_S || res === null);

    const camminata = {
      kind: "walk" as const,
      from: null,
      to: null,
      minutes: Math.max(1, Math.round(soloPiediS / 60)),
      meters: direttoM,
    };

    if (piediComePrincipale) {
      return NextResponse.json({
        options: [
          {
            departAt: new Date(departEpoch * 1000).toISOString(),
            arriveAt: new Date((departEpoch + soloPiediS) * 1000).toISOString(),
            durationMin: camminata.minutes,
            walkMin: camminata.minutes,
            walkSeconds: soloPiediS,
            rides: 0,
            lines: [],
            legs: [camminata],
          },
        ],
        walkOption: null,
      });
    }

    if (!res) {
      return NextResponse.json({ error: "nessun itinerario trovato", options: [] }, { status: 404 });
    }

    // Anagrafica solo per le fermate e le corse effettivamente negli
    // itinerari: sono una manciata, non vale caricare tutto il feed.
    const stopIds = new Set<string>();
    const tripIds = new Set<string>();
    for (const r of risultati) {
      for (const leg of r.legs) {
        if (leg.kind === "ride") {
          stopIds.add(cs.stopIds[leg.fromStop]);
          stopIds.add(cs.stopIds[leg.toStop]);
          tripIds.add(cs.tripSourceId[leg.tripIdx]);
        } else {
          if (leg.fromStop !== null) stopIds.add(cs.stopIds[leg.fromStop]);
          if (leg.toStop !== null) stopIds.add(cs.stopIds[leg.toStop]);
        }
      }
    }

    const [stopRows, tripRows] = await Promise.all([
      sql<{ stop_id: string; name: string; code: string | null }[]>`
        SELECT stop_id, name, code FROM stops WHERE stop_id = ANY(${[...stopIds]})
      `,
      tripIds.size > 0
        ? sql<{ trip_id: string; short_name: string; color: string | null; text_color: string | null; headsign: string | null }[]>`
            SELECT t.trip_id, r.short_name, r.color, r.text_color, t.headsign
            FROM trips t JOIN routes r ON r.route_id = t.route_id
            WHERE t.trip_id = ANY(${[...tripIds]})
          `
        : Promise.resolve([]),
    ]);

    const stopById = new Map(stopRows.map((s) => [s.stop_id, s]));
    const tripById = new Map(tripRows.map((t) => [t.trip_id, t]));

    const iso = (rel: number) => new Date((cs.baseEpoch + rel) * 1000).toISOString();
    const fermata = (idx: number) => {
      const id = cs.stopIds[idx];
      const s = stopById.get(id);
      return { stopId: id, name: s?.name ?? id, code: s?.code ?? null };
    };

    const rendi = (r: NonNullable<typeof res>) => {
      // Tratti a piedi consecutivi uniti: camminare fino a una fermata per poi
      // ripartire a piedi non significa niente per chi legge, ed è quello che
      // succede quando l'ultimo trasferimento porta su una fermata da cui poi
      // si esce a piedi verso la destinazione.
      const unite: Leg[] = [];
      for (const leg of r.legs) {
        const prec = unite[unite.length - 1];
        if (leg.kind === "walk" && prec && prec.kind === "walk") {
          unite[unite.length - 1] = {
            kind: "walk",
            fromStop: prec.fromStop,
            toStop: leg.toStop,
            seconds: prec.seconds + leg.seconds,
            departAt: prec.departAt,
            arriveAt: leg.arriveAt,
          };
        } else {
          unite.push(leg);
        }
      }

      let walkS = 0;
      const legs = unite.map((leg: Leg) => {
        if (leg.kind === "walk") {
          walkS += leg.seconds;
          return {
            kind: "walk" as const,
            from: leg.fromStop === null ? null : fermata(leg.fromStop),
            to: leg.toStop === null ? null : fermata(leg.toStop),
            minutes: Math.max(1, Math.round(leg.seconds / 60)),
            departAt: iso(leg.departAt),
            arriveAt: iso(leg.arriveAt),
          };
        }
        const tripId = cs.tripSourceId[leg.tripIdx];
        const t = tripById.get(tripId);
        return {
          kind: "ride" as const,
          tripId,
          shortName: t?.short_name ?? "?",
          color: t?.color ?? null,
          textColor: t?.text_color ?? null,
          headsign: t?.headsign ?? null,
          from: fermata(leg.fromStop),
          to: fermata(leg.toStop),
          departAt: iso(leg.departAt),
          arriveAt: iso(leg.arriveAt),
          minutes: Math.max(1, Math.round((leg.arriveAt - leg.departAt) / 60)),
        };
      });

      const corse = legs.filter((l) => l.kind === "ride");
      return {
        departAt: iso(r.departAt),
        arriveAt: iso(r.arriveAt),
        durationMin: Math.round((r.arriveAt - (departEpoch - cs.baseEpoch)) / 60),
        walkMin: Math.round(walkS / 60),
        walkSeconds: walkS,
        rides: corse.length,
        /** Le linee in ordine: serve a riconoscere l'itinerario a colpo d'occhio. */
        lines: corse.map((l) => (l.kind === "ride" ? l.shortName : "")),
        legs,
        // Firma per riconoscere due scansioni che hanno prodotto lo stesso
        // itinerario: tetti di cambi diversi arrivano spesso alla stessa
        // risposta.
        firma: corse
          .map((l) => (l.kind === "ride" ? `${l.shortName}@${l.from.stopId}>${l.to.stopId}@${l.departAt}` : ""))
          .join("|"),
      };
    };

    const rese = risultati.map(rendi);

    // Si scartano i doppioni e le opzioni dominate: un itinerario che arriva
    // più tardi, con più cambi E più cammino di un altro non è una scelta, è
    // rumore. Restano solo quelle in cui si rinuncia a qualcosa per guadagnare
    // altro, che è ciò su cui vale la pena decidere.
    const viste = new Set<string>();
    const uniche = rese.filter((o) => {
      if (viste.has(o.firma)) return false;
      viste.add(o.firma);
      return true;
    });
    // Un'opzione che dura il doppio della migliore non è una scelta, è una
    // trappola: con i tetti di cambi bassi la scansione trova itinerari
    // formalmente non dominati — meno cambi, meno cammino — che però aspettano
    // la corsa utile del giorno dopo. Misurato: da Via Apiro compariva una C5
    // da 1454 minuti.
    const piuRapida = Math.min(...uniche.map((o) => o.durationMin));
    const sensate = uniche.filter((o) => o.durationMin <= piuRapida * 2 + 15);

    const options = sensate
      .filter(
        (o) =>
          !sensate.some(
            (a) =>
              a !== o &&
              a.arriveAt <= o.arriveAt &&
              a.rides <= o.rides &&
              a.walkSeconds <= o.walkSeconds &&
              (a.arriveAt < o.arriveAt || a.rides < o.rides || a.walkSeconds < o.walkSeconds),
          ),
      )
      .sort((a, b) => a.arriveAt.localeCompare(b.arriveAt) || a.rides - b.rides)
      .slice(0, 5)
      // La firma serviva solo a deduplicare, non a chi legge.
      .map(({ firma, ...resto }) => resto);

    if (options.length === 0) {
      return NextResponse.json({ error: "nessun itinerario trovato", options: [] }, { status: 404 });
    }

    return NextResponse.json({
      options,
      // Presente solo se camminare è un'alternativa sensata da confrontare.
      walkOption: camminabile ? { minutes: camminata.minutes, meters: direttoM } : null,
    });
  } catch (e) {
    console.error("[plan]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
