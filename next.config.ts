import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Origini consentite per le richieste cross-origin in sviluppo (dev su LAN).
  allowedDevOrigins: ["192.168.1.6"],
  // Abilita l'output standalone per il container Docker (copia solo i file necessari).
  output: "standalone",
};

export default nextConfig;
