import SearchBar from "@/components/SearchBar";
import Benvenuto from "@/components/Benvenuto";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";
import SupportBanner from "@/components/SupportBanner";
import HeaderActions from "@/components/HeaderActions";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      {/* Il titolo dice cosa c'è in pagina — "Fermate" — come su Percorsi,
          Ritardi e Preferiti: era l'unica delle quattro a scrivere il nome
          dell'app al posto del proprio contenuto.
          Il nome non sparisce, cambia posto: sta nell'icona sul telefono, nel
          titolo della scheda, nella schermata del primo avvio e nella firma in
          fondo alla pagina. A chi l'app l'ha già aperta, ripeterglielo in cima
          non dice niente, e nemmeno il marchio accanto al titolo: l'icona la
          si è già toccata per entrare.
          Niente sottotitolo: il campo di ricerca dice già "cerca una linea o
          una fermata", e scriverlo due volte è solo spazio rubato agli arrivi. */}
      <header className="mb-4 flex items-center gap-2">
        <h1 className="flex-1 text-[22px] font-bold tracking-tight text-neutral-900">Fermate</h1>
        <HeaderActions />
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
