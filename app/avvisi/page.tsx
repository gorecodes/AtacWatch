import BackButton from "@/components/BackButton";
import HeaderActions from "@/components/HeaderActions";
import ElencoAvvisi from "@/components/ElencoAvvisi";

export const metadata = { title: "Avvisi — Bus Roma" };

export default function AvvisiPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <BackButton />
        <HeaderActions />
      </div>

      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-neutral-900">Avvisi</h1>
      <p className="mb-4 text-[13px] text-neutral-600">
        Deviazioni, sospensioni e modifiche di percorso dichiarate da ATAC.
        Prima quelle di oggi, poi i cantieri che vanno avanti da mesi.
      </p>

      <ElencoAvvisi />
    </div>
  );
}
