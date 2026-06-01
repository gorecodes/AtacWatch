import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Attàccate — mezzi di Roma in tempo reale",
  description:
    "Bus, tram e metro di Roma in tempo reale: cerca le linee, vedi gli arrivi alle fermate e i mezzi sulla mappa.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Attàccate" },
};

export const viewport: Viewport = {
  themeColor: "#1e2631",
  width: "device-width",
  initialScale: 1,
  // Niente blocco dello zoom: il pinch-to-zoom è un requisito di accessibilità
  // (WCAG 1.4.4). initialScale=1 evita comunque l'auto-zoom sui campi input.
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <main className="flex-1">{children}</main>
        <RegisterSW />
      </body>
    </html>
  );
}
