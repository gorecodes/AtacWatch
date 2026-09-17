import JourneyPlanner from "@/components/JourneyPlanner";

export const metadata = { title: "Percorsi — Bus Roma" };

export default function PlanPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      {/* Nessun ritorno in alto: questa pagina è una voce della navigazione in
          basso, e un secondo modo di uscirne sarebbe solo rumore. */}
      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-neutral-900">Percorsi</h1>
      <p className="mb-4 text-[13px] text-neutral-600">
        Da via a via, da fermata a fermata, o dalla tua posizione.
      </p>

      <JourneyPlanner />
    </div>
  );
}
