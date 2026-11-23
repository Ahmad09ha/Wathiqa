import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* The editor uses plain CSS; no Tailwind loader is needed. */
  async rewrites() {
    return [{
      source: "/import-api/:path*",
      destination: (process.env.IMPORT_API_INTERNAL_URL || "http://127.0.0.1:5089") + "/:path*"
    }];
  }
};

export default nextConfig;
