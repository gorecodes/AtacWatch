import SearchBar from "@/components/SearchBar";
import Benvenuto from "@/components/Benvenuto";
import Marchio from "@/components/Marchio";
import ThemeToggle from "@/components/ThemeToggle";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";
import SupportBanner from "@/components/SupportBanner";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-5">
      {/* Intestazione su una riga sola: prima i crediti e il sottotitolo si
          mangiavano 130px dei 900 di viewport, sopra la piega. */}
      {/* Col marchio accanto al titolo, il sottotitolo "Roma in tempo reale"
          diventa decorazione: dice ciò che il marchio già mostra, e su uno
          schermo da 360 pixel rubava lo spazio che serve al tasto del tema. */}
      <header className="mb-4 flex items-center gap-2.5">
        <Marchio className="h-8 w-8 shrink-0 text-neutral-900" />
        <h1 className="name flex-1 text-[26px] font-bold leading-none tracking-tight text-neutral-900">
          Bus Roma
        </h1>
        <ThemeToggle />
      </header>

      <Benvenuto />

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
