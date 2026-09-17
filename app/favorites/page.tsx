import Link from "next/link";
import FavoritesList from "@/components/FavoritesList";
import { BackGlyph } from "@/components/Glyphs";

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <header className="mb-4 flex items-center gap-2">
        <Link
          href="/"
          aria-label="Torna alla home"
          className="-ml-1.5 flex items-center gap-1 rounded p-1.5 text-neutral-500 active:text-neutral-900"
        >
          <BackGlyph className="h-4 w-4" />
          <span className="text-[13px]">Home</span>
        </Link>
      </header>

      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-neutral-900">Preferiti</h1>
      <p className="mb-4 text-[13px] text-neutral-600">Trascina per riordinare · tocca la stella per rimuovere.</p>

      <FavoritesList />
    </div>
  );
}
