import SearchBar from "@/components/SearchBar";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <header className="mb-5">
        <p className="mb-0.5 text-[10px] font-semibold tracking-widest uppercase text-brand-600">Roma · Trasporto Pubblico</p>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">AtacWatch</h1>
        <p className="text-sm text-neutral-500">Mezzi di Roma in tempo reale</p>
        <p className="mt-1.5 text-[10px] text-neutral-400">
          Dati ufficiali: Roma Servizi per la Mobilità (ATAC, Roma TPL) · licenza CC-BY-SA
        </p>
      </header>

      <SearchBar />

      <div className="mt-6">
        <FavoriteStops />
        <NearbyArrivals />
      </div>
    </div>
  );
}
