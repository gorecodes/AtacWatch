import FavoritesList from "@/components/FavoritesList";

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      {/* Nessun ritorno in alto: è una voce della navigazione in basso. */}
      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-neutral-900">Preferiti</h1>
      <p className="mb-4 text-[13px] text-neutral-600">Trascina per riordinare · tocca la stella per rimuovere.</p>

      <FavoritesList />
    </div>
  );
}
