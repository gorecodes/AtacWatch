import StatsRitardi from "@/components/StatsRitardi";
import HeaderActions from "@/components/HeaderActions";

export const metadata = { title: "Ritardi — Bus Roma" };

export default function RitardiPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      {/* Nessun ritorno in alto: è una voce della navigazione in basso. */}
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">Ritardi</h1>
        <span className="rounded-[3px] bg-brand-500 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
          Beta
        </span>
        <span className="ml-auto">
          <HeaderActions />
        </span>
      </div>
      <p className="mb-4 text-[13px] text-neutral-600">
        Quanto sono puntuali le linee di Roma, misurato giorno per giorno sul feed ATAC.
        Nessuno lo pubblica: lo contiamo noi.
      </p>

      <StatsRitardi />
    </div>
  );
}
