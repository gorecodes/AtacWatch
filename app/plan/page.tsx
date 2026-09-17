import { Suspense } from "react";
import JourneyPlanner from "@/components/JourneyPlanner";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = { title: "Percorsi — Bus Roma" };

export default function PlanPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      {/* Nessun ritorno in alto: questa pagina è una voce della navigazione in
          basso, e un secondo modo di uscirne sarebbe solo rumore. */}
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">Percorsi</h1>
        {/* Dichiarato, non nascosto: il calcolo non usa il tempo reale, gli
            indirizzi vengono da OpenStreetMap e possono mancare. Meglio
            scriverlo che far scoprire i limiti a chi sta correndo. */}
        <span className="rounded-[3px] bg-brand-500 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
          Beta
        </span>
        {/* Il tasto del tema è l'ultimo elemento in alto a destra su OGNI
            pagina: stava solo sulla home, e chi era altrove doveva tornare
            indietro per cambiarlo. */}
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </div>
      <p className="mb-4 text-[13px] text-neutral-600">
        Da via a via, da fermata a fermata, o dalla tua posizione. Gli orari sono
        da tabella, senza il tempo reale: verifica sempre il passaggio sulla
        pagina della fermata.
      </p>

      {/* JourneyPlanner legge l'indirizzo per sapere quale itinerario è aperto,
          e useSearchParams richiede un confine di sospensione su una rotta
          statica come questa. */}
      <Suspense fallback={<p className="text-[14px] text-neutral-500">Carico…</p>}>
        <JourneyPlanner />
      </Suspense>
    </div>
  );
}
