import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Origini consentite per le richieste cross-origin in sviluppo (dev su LAN).
  allowedDevOrigins: ["192.168.1.6"],
};

export default nextConfig;
