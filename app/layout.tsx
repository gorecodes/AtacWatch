import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCond = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-cond",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AtacWatch — mezzi di Roma in tempo reale",
  description:
    "Bus, tram e metro di Roma in tempo reale: cerca le linee, vedi gli arrivi alle fermate e i mezzi sulla mappa.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AtacWatch" },
};

export const viewport: Viewport = {
  themeColor: "#1B2027",
  width: "device-width",
  initialScale: 1,
  // Niente blocco dello zoom: il pinch-to-zoom è un requisito di accessibilità
  // (WCAG 1.4.4). initialScale=1 evita comunque l'auto-zoom sui campi input.
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className={`h-full antialiased ${barlow.variable} ${barlowCond.variable}`}>
      <body className="min-h-full flex flex-col bg-neutral-100 text-neutral-900">
        <main className="flex-1">{children}</main>
        <footer className="mx-auto w-full max-w-lg px-4 py-6 text-[11px] leading-relaxed text-neutral-400">
          Dati di Roma Servizi per la Mobilità (ATAC, Roma TPL), licenza CC-BY-SA.
          Gli orari in tempo reale dipendono dal feed ATAC e possono mancare.
        </footer>
        <RegisterSW />
      </body>
    </html>
  );
}
