/**
 * Avvisi di servizio ATAC: classificazione e pulizia del testo.
 *
 * LA DISTINZIONE CHE CONTA. Nel feed convivono due cose diversissime, e
 * trattarle allo stesso modo rende la feature inutile:
 *
 *   - 130 avvisi di CANTIERE, durata media 166 giorni. Piazza Venezia è
 *     deviata dal 1° gennaio al 31 ottobre. Se ci metto un badge rosso marchio
 *     mezza rete di Roma in permanenza, e un avviso sempre acceso dopo tre
 *     giorni non lo vede più nessuno: diventa carta da parati.
 *   - 36 avvisi di MANIFESTAZIONE, durata media 0 giorni, tutti con inizio
 *     oggi o domani. Questi sì: succedono adesso, non li sai, e ti fregano.
 *
 * La durata separa i due casi senza ambiguità — misurato sul feed vero, non
 * ipotizzato — quindi è il criterio. Niente euristiche sul testo.
 */

export type AvvisoRaw = {
  id: string;
  header: string | null;
  description: string | null;
  cause: string | null;
  effect: string | null;
  route_ids: string[] | null;
  start_ts: string | null;
  end_ts: string | null;
  /** Solo per ?stop=: le linee dell'avviso che fermano davvero lì. */
  linee_qui?: string[] | null;
  /** Solo per ?stop=: ATAC dichiara questa fermata tra quelle coinvolte. */
  tocca_qui?: boolean | null;
};

export type Avviso = {
  id: string;
  titolo: string;
  dettaglio: string | null;
  effetto: string;
  causa: string | null;
  urgente: boolean;
  /** Formato "fino al 31 ottobre" o "oggi", per dirlo senza far contare i giorni. */
  quando: string | null;
  linee: string[];
  /**
   * Le linee coinvolte con il nome che conosce la gente ("60", non il
   * route_id), limitate a quelle pertinenti al contesto. Sulla fermata è
   * l'informazione che rende l'avviso utilizzabile: senza di essa si legge
   * "deviata per manifestazione" senza sapere deviata chi.
   */
  lineeQui: string[];
  /**
   * ATAC dichiara esplicitamente che questa fermata è coinvolta. Vero in 3
   * avvisi su 181: quando è falso NON vuol dire che la fermata sia salva, vuol
   * dire che non lo sappiamo, e le parole in pagina cambiano di conseguenza.
   */
  toccaQui: boolean;
};

/**
 * Le virgolette di Windows finite nel feed.
 *
 * ATAC scrive i testi in Windows-1252 e da qualche parte nella catena i byte
 * 0x80–0x9F vengono interpretati come codepoint Unicode invece che tradotti.
 * Risultato: nel database c'è `Lavori Realizzazione tranviaria`
 * invece di «Lavori "Realizzazione tranviaria"». Senza questa tabella
 * l'utente legge `` in pagina.
 *
 * Si gestiscono entrambe le forme: la sequenza letterale di sei caratteri e
 * il codepoint vero, perché a seconda del punto della catena può arrivare
 * l'una o l'altra e non vale la pena scommettere su quale.
 */
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž",
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

export function pulisci(testo: string | null): string {
  if (!testo) return "";
  return (
    testo
      // Forma letterale: i sei caratteri 
      .replace(/\\u00([89][0-9a-f])/gi, (m, hex) => CP1252[parseInt(hex, 16)] ?? m)
      // Forma vera: il codepoint di controllo C1
      .replace(/[-]/g, (c) => CP1252[c.charCodeAt(0)] ?? "")
      // ATAC scrive tutto in maiuscolo su molti avvisi: lasciato com'è,
      // perché riscriverlo a mano sbaglierebbe i nomi propri.
      .trim()
  );
}

/** GTFS-RT Alert.Effect → parola che un passeggero capisce. */
const EFFETTI: Record<string, string> = {
  "1": "Servizio sospeso",
  "2": "Servizio ridotto",
  "3": "Forti ritardi",
  "4": "Deviata",
  "5": "Corse aggiuntive",
  "6": "Percorso modificato",
  "7": "Avviso",
  "8": "Avviso",
  "9": "Fermata spostata",
};

/** GTFS-RT Alert.Cause → il perché, quando aggiunge qualcosa. */
const CAUSE: Record<string, string> = {
  "3": "guasto",
  "4": "sciopero",
  "5": "manifestazione",
  "6": "incidente",
  "7": "festività",
  "8": "maltempo",
  "9": "manutenzione",
  "10": "cantiere",
  "11": "attività di polizia",
  "12": "emergenza sanitaria",
};

/**
 * Quanto dura l'avviso, in giorni. Oltre la soglia è strutturale.
 *
 * Due giorni e non uno: una manifestazione annunciata per domani ha `start`
 * domani e `end` domani sera, ma il troncamento alla data può far uscire 1.
 * Il margine non ammette nessun cantiere, che parte da settimane.
 */
const GIORNI_URGENTE = 2;

function durataGiorni(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms / 86_400_000;
}

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

function dataItaliana(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MESI[d.getMonth()]}`;
}

/**
 * Da riga di database a cosa da mostrare.
 *
 * Gli avvisi non attivi ADESSO vengono scartati: il feed ne conserva di
 * scaduti, e un avviso finito ad aprile in pagina a settembre è un bug che
 * sembra incuria.
 */
export function normalizza(r: AvvisoRaw, adesso: Date = new Date()): Avviso | null {
  const inizio = r.start_ts ? new Date(r.start_ts) : null;
  const fine = r.end_ts ? new Date(r.end_ts) : null;
  if (fine && fine < adesso) return null;
  if (inizio && inizio > new Date(adesso.getTime() + 7 * 86_400_000)) return null;

  const durata = durataGiorni(r.start_ts, r.end_ts);
  const urgente = durata !== null && durata <= GIORNI_URGENTE;

  const titolo = pulisci(r.header);
  const dettaglio = pulisci(r.description);

  // La descrizione che ripete il titolo non aggiunge niente e raddoppia
  // l'altezza del riquadro.
  const dettaglioUtile =
    dettaglio && dettaglio.toLowerCase() !== titolo.toLowerCase() ? dettaglio : null;

  let quando: string | null = null;
  if (urgente) {
    quando = inizio && inizio > adesso ? `dal ${dataItaliana(r.start_ts!)}` : "in corso";
  } else if (fine) {
    quando = `fino al ${dataItaliana(r.end_ts!)}`;
  }

  return {
    id: r.id,
    titolo: titolo || "Avviso di servizio",
    dettaglio: dettaglioUtile,
    effetto: EFFETTI[r.effect ?? ""] ?? "Avviso",
    causa: CAUSE[r.cause ?? ""] ?? null,
    urgente,
    quando,
    linee: r.route_ids ?? [],
    lineeQui: r.linee_qui ?? [],
    toccaQui: r.tocca_qui === true,
  };
}
