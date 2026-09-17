"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StopGlyph, RouteGlyph, StarGlyph, DelayGlyph } from "./Glyphs";

/**
 * Navigazione in basso.
 *
 * Prima ogni pagina si raggiungeva dalla home e ogni ritorno stava IN ALTO,
 * che è il punto più scomodo da raggiungere col pollice su un telefono. Le tre
 * destinazioni ora sono sempre a portata, dove la mano già sta.
 *
 * Le voci sono alte 56px più l'area di sicurezza del telefono: sopra i 44px
 * raccomandati, e con l'etichetta sotto l'icona perché un glifo da solo è
 * ambiguo.
 */
const VOCI = [
  { href: "/", label: "Fermate", glifo: "stop" as const },
  { href: "/plan", label: "Percorsi", glifo: "route" as const },
  { href: "/ritardi", label: "Ritardi", glifo: "delay" as const },
  { href: "/favorites", label: "Preferiti", glifo: "star" as const },
];

export default function BottomNav() {
  const path = usePathname();

  return (
    <nav
      aria-label="Navigazione principale"
      className="sticky bottom-0 z-40 border-t border-neutral-300 bg-neutral-50/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {VOCI.map((v) => {
          // La home è attiva solo su esatta corrispondenza, altrimenti lo
          // sarebbe su ogni pagina dell'app.
          const attiva = v.href === "/" ? path === "/" : path.startsWith(v.href);
          return (
            <li key={v.href} className="flex-1">
              <Link
                href={v.href}
                aria-current={attiva ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 ${
                  attiva ? "text-neutral-900" : "text-neutral-500"
                }`}
              >
                {v.glifo === "stop" && <StopGlyph className="h-6 w-6" />}
                {v.glifo === "route" && <RouteGlyph className="h-6 w-6" />}
                {v.glifo === "delay" && <DelayGlyph className="h-6 w-6" />}
                {v.glifo === "star" && <StarGlyph filled={attiva} className="h-6 w-6" />}
                <span className={`text-[11px] ${attiva ? "font-semibold" : ""}`}>{v.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
