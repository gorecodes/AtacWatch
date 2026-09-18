import FavoritesList from "@/components/FavoritesList";
import HeaderActions from "@/components/HeaderActions";

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      {/* Nessun ritorno in alto: è una voce della navigazione in basso. */}
      <div className="mb-1 flex items-center gap-2">
        <h1 className="flex-1 text-[22px] font-bold tracking-tight text-neutral-900">Preferiti</h1>
        <HeaderActions />
      </div>
      <p className="mb-4 text-[13px] text-neutral-600">Trascina per riordinare · tocca la stella per rimuovere.</p>

      <FavoritesList />
    </div>
  );
}
