import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isDev = process.env.NODE_ENV !== "production";

// Strict CSP. Next.js needs 'unsafe-inline' for its inline bootstrap scripts unless nonces
// are wired through middleware (planned with Sentry in Phase 12).
// Map tile hosts: base maps (OSM fallback, Esri imagery, optional MapTiler) and label glyphs.
const MAP_HOSTS = [
  "https://tile.openstreetmap.org",
  "https://server.arcgisonline.com",
  "https://api.maptiler.com",
  "https://demotiles.maplibre.org",
].join(" ");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseUrl} ${MAP_HOSTS}`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseUrl.replace(/^http/, "ws")} ${MAP_HOSTS}`,
  // MapLibre renders in a web worker created from a blob.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // Development allows same-site frames so pages can be checked at several widths at once.
  isDev ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // A separate build folder lets `next build` run while the dev server uses .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@dhulka/ui", "@dhulka/core"],
  // Report files (PDF/Excel) are built on the server with these; load them from node_modules as-is.
  serverExternalPackages: ["exceljs", "jspdf", "jspdf-autotable"],
  experimental: {
    authInterrupts: true,
    // Document uploads go through server actions (10 MB files + form overhead).
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: isDev ? "SAMEORIGIN" : "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
