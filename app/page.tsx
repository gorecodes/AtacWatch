import SearchBar from "@/components/SearchBar";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";
import SupportBanner from "@/components/SupportBanner";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-5">
      {/* Intestazione su una riga sola: prima i crediti e il sottotitolo si
          mangiavano 130px dei 900 di viewport, sopra la piega. */}
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="name text-[26px] font-bold leading-none tracking-tight text-neutral-900">
          Bus Roma
        </h1>
        <p className="shrink-0 text-[13px] text-neutral-500">Roma in tempo reale</p>
      </header>

      <SearchBar />

      {/* Il link ai percorsi non serve più: è una voce della navigazione in
          basso, sempre a portata di pollice. I preferiti vengono prima perché
          non chiedono il permesso di posizione, quindi sono l'unica cosa utile
          al primo colpo.

          Il banner del caffè sta QUI, tra i due blocchi, e non in fondo: la
          lista degli arrivi vicini è lunga e in fondo non ci arriva nessuno.
          È una decisione già presa, da non rimettere in discussione. */}
      <div className="mt-6 space-y-7">
        <FavoriteStops />
        <SupportBanner />
        <NearbyArrivals />
      </div>
    </div>
  );
}
