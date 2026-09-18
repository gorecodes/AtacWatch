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

/**
 * Finestra di campionamento, a cavallo dell'ora richiesta.
 *
 * L'orario NON deve decidere quali percorsi esistono, solo quali servizi
 * circolano in quella fascia: di giorno non si propongono i notturni, di notte
 * non si propongono i diurni.
 *
 * Si campiona anche INDIETRO, ed è la parte controintuitiva: un percorso la
 * cui corsa è appena passata è un percorso validissimo, e guardando solo in
 * avanti spariva. Guardando indietro lo si trova comunque.
 *
 * La finestra è stretta di proposito. Con tre ore in avanti, chiedendo alle 3
 * di notte si arrivava alle 6 e ricomparivano gli autobus diurni, che a
 * quell'ora non sono una scelta. Così invece resta dentro la fascia.
 */
const FINESTRA_INDIETRO_MIN = 60;
const FINESTRA_AVANTI_MIN = 90;

/** Passo di campionamento dentro la finestra. */
const PASSO_MIN = 30;

/**
 * NON esiste un filtro sull'attesa, ed è deliberato.
 *
 * Che una singola corsa sia già passata non dice niente sulla bontà di un
 * percorso: l'elenco deve mostrare i percorsi MIGLIORI, non quelli ancora
 * prendibili in questo minuto. A decidere cosa circola è la finestra, che
 * resta dentro la fascia di servizio e tiene quindi fuori i diurni di notte e
 * i notturni di giorno. Quando serve sapere a che ora passa il prossimo, la
 * risposta è nella pagina della fermata.
 */

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
    const [fp, access, egress, diretto] = await Promise.all([
      loadFootpaths(sql, cs, dateISO),
      findAccess(sql, cs, fromLat, fromLon, undefined, "andata"),
      // "ritorno": dalle fermate alla destinazione. A piedi la differenza è
      // minima, ma sottopassi e sensi unici pedonali non sono simmetrici.
      findAccess(sql, cs, toLat, toLon, undefined, "ritorno"),
      walkDistance(sql, fromLat, fromLon, toLat, toLon),
    ]);

    const direttoM = diretto.meters;
    const soloPiediS = diretto.seconds;
    const camminabile = direttoM <= MAX_WALK_ALT_M;

    // Raggio stretto: obbliga a salire vicino al punto di partenza invece di
    // raggiungere a piedi una fermata più a monte. Almeno la fermata più
    // vicina resta sempre disponibile, altrimenti in periferia il raggio
    // stretto non ne conterrebbe nessuna.
    const stretto = (l: typeof access) => {
      const v = l.filter((x) => x.meters <= ACCESS_TIGHT_M);
      return v.length > 0 ? v : l.slice(0, 1);
    };

    // Il fronte delle opzioni. Non esiste un itinerario "giusto" — chi ha
    // fretta, chi non vuole cambiare e chi non vuole camminare ne vogliono tre
    // diversi — quindi si generano e si mostrano tutti, come fa Google Maps.
    //
    // Si scandisce per ogni tetto di cambi E da più orari dentro la finestra.
    // Serve perché la scansione da un solo istante restituisce il percorso che
    // arriva prima, non tutti i percorsi: uno più semplice la cui corsa passa
    // un'ora dopo resterebbe invisibile, pur essendo il migliore per chi non ha
    // l'obbligo di partire in quel minuto. Ogni scansione costa un paio di
    // millisecondi, quindi campionare la finestra è gratis.
    //
    // I campioni sono ancorati all'ORA TONDA, non all'istante richiesto: così
    // chiedere alle 09:00 o alle 09:17 esplora gli stessi orari e restituisce
    // lo stesso elenco di percorsi. Ancorandoli alla richiesta, la griglia si
    // spostava col minuto e l'elenco cambiava sotto le dita.
    const ancora = Math.floor(departEpoch / 3600) * 3600;
    const offsets: number[] = [];
    for (let m = -FINESTRA_INDIETRO_MIN; m <= FINESTRA_AVANTI_MIN; m += PASSO_MIN) {
      offsets.push(ancora - departEpoch + m * 60);
    }
    const risultati =
      access.length > 0 && egress.length > 0
        ? offsets
            .flatMap((off) => [
              ...[1, 2, 3, 4].map((cap) =>
                csaEarliestArrival(cs, fp, access, egress, departEpoch + off, cap),
              ),
              ...[2, 3].map((cap) =>
                csaEarliestArrival(cs, fp, stretto(access), stretto(egress), departEpoch + off, cap),
              ),
            ])
            .filter((r): r is NonNullable<typeof r> => r !== null)
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
            esempio: false,
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
      // Le coordinate servono a disegnare l'itinerario su una mappa. Sono
      // qui e non in un endpoint a parte perché non esiste un modo di
      // tradurre un identificativo di fermata in coordinate: /api/stops/search
      // non le espone e /api/stops/:id/arrivals nemmeno. Il client altrimenti
      // deve indovinarle dal percorso della linea, che sulle corse variante
      // non combacia.
      sql<{ stop_id: string; name: string; code: string | null; lat: number; lon: number }[]>`
        SELECT stop_id, name, code,
               st_y(geom)::float8 AS lat,
               st_x(geom)::float8 AS lon
        FROM stops WHERE stop_id = ANY(${[...stopIds]})
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
      return {
        stopId: id,
        name: s?.name ?? id,
        code: s?.code ?? null,
        // Nulle solo se la fermata non è nella tabella, che non dovrebbe
        // succedere: il router le ha prese da lì.
        lat: s?.lat ?? null,
        lon: s?.lon ?? null,
      };
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
      const lines = corse.map((l) => (l.kind === "ride" ? l.shortName : ""));
      return {
        departAt: iso(r.departAt),
        arriveAt: iso(r.arriveAt),
        /**
         * Tempo dal momento in cui esci di casa a quello in cui arrivi:
         * cammino, viaggio e cambi, MA NON l'attesa iniziale. Quella non è una
         * proprietà del percorso, dipende solo da quando ti trovi a uscire, e
         * conteggiarla faceva sembrare scarso un itinerario ottimo solo perché
         * l'autobus era appena passato.
         */
        durationMin: Math.round((r.arriveAt - r.departAt) / 60),
        /**
         * Gli orari sono di UNA corsa a titolo d'esempio, quella col viaggio
         * più breve. Non sono "la" partenza: il percorso vale a prescindere,
         * e per il prossimo passaggio c'è la pagina della fermata.
         */
        esempio: true,
        walkMin: Math.round(walkS / 60),
        walkSeconds: walkS,
        rides: corse.length,
        /** Le linee in ordine: serve a riconoscere l'itinerario a colpo d'occhio. */
        lines,
        legs,
        // Firma per riconoscere due scansioni che hanno prodotto lo stesso
        // PERCORSO. È la sequenza di linee e non gli orari: la stessa
        // combinazione trovata partendo venti minuti dopo è lo stesso percorso,
        // e va mostrata una volta sola.
        firma: lines.join("|") || "piedi",
      };
    };

    const rese = risultati.map(rendi);

    // Si scartano i doppioni e le opzioni dominate: un itinerario che arriva
    // più tardi, con più cambi E più cammino di un altro non è una scelta, è
    // rumore. Restano solo quelle in cui si rinuncia a qualcosa per guadagnare
    // altro, che è ciò su cui vale la pena decidere.
    // Per ogni percorso si tiene l'istanza col VIAGGIO PIÙ BREVE, che è la
    // caratteristica del percorso. Non la prossima corsa prendibile: che un
    // singolo passaggio sia già andato non dice nulla su quanto sia buono il
    // percorso, e filtrare su quello faceva cambiare l'elenco di minuto in
    // minuto.
    const migliori = new Map<string, (typeof rese)[number]>();
    for (const o of rese) {
      const p = migliori.get(o.firma);
      if (!p || o.durationMin < p.durationMin) migliori.set(o.firma, o);
    }
    const uniche = [...migliori.values()];
    if (uniche.length === 0) {
      return NextResponse.json({ error: "nessun itinerario trovato", options: [] }, { status: 404 });
    }
    // Unico filtro: un percorso che dura il doppio del migliore non è una
    // scelta. Nessun filtro sull'orario, per quanto detto sopra.
    const piuRapida = Math.min(...uniche.map((o) => o.durationMin));
    const sensate = uniche.filter((o) => o.durationMin <= piuRapida * 2 + 15);

    const options = sensate
      .filter(
        (o) =>
          !sensate.some(
            (a) =>
              a !== o &&
              a.durationMin <= o.durationMin &&
              a.rides <= o.rides &&
              a.walkSeconds <= o.walkSeconds &&
              (a.durationMin < o.durationMin ||
                a.rides < o.rides ||
                a.walkSeconds < o.walkSeconds),
          ),
      )
      // Si ordina per tempo di viaggio, che è il criterio di chi sceglie un
      // percorso. L'orario di quella specifica corsa non c'entra.
      .sort((a, b) => a.durationMin - b.durationMin || a.rides - b.rides)
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
