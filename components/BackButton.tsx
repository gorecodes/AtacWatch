"use client";

import { useRouter } from "next/navigation";
import { BackGlyph } from "./Glyphs";

/**
 * Indietro vero, cioè la cronologia.
 *
 * Prima la pagina fermata e quella della linea avevano un collegamento FISSO
 * alla home: arrivandoci da un itinerario o da una ricerca, il tasto riportava
 * comunque alle fermate, buttando via il punto in cui si era. Quale sia la
 * pagina precedente lo sa solo la cronologia.
 *
 * Il ripiego serve a chi apre una fermata da una notifica o da un link
 * condiviso: lì non c'è niente da risalire.
 */
export default function BackButton({ label = "Indietro" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      aria-label="Torna indietro"
      className="-ml-2 flex h-11 items-center gap-1 rounded-full px-2.5 text-neutral-500 active:text-neutral-900"
    >
      <BackGlyph className="h-4 w-4" />
      <span className="text-[13px]">{label}</span>
    </button>
  );
}
