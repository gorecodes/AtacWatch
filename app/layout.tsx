import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "AtacWatch — mezzi di Roma in tempo reale",
  description:
    "Bus, tram e metro di Roma in tempo reale: cerca le linee, vedi gli arrivi alle fermate e i mezzi sulla mappa.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AtacWatch" },
};

export const viewport: Viewport = {
  themeColor: "#8A1528",
  width: "device-width",
  initialScale: 1,
  // Niente blocco dello zoom: il pinch-to-zoom è un requisito di accessibilità
  // (WCAG 1.4.4). initialScale=1 evita comunque l'auto-zoom sui campi input.
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-800">
        <div className="sticky top-0 z-50 h-1.5 bg-brand-600" />
        <main className="flex-1">{children}</main>
        <RegisterSW />
      </body>
    </html>
  );
}
