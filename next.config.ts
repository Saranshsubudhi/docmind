import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse loads pdf.js's worker from disk at runtime; bundling breaks
  // that path, so load it with plain Node require instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Keep the dev-mode badge off the sidebar's Documents panel.
  devIndicators: { position: "top-right" },
};

export default nextConfig;
