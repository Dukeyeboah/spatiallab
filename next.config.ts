import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // r3f-perf ships a source map pointing at a binary font file, which crashes
    // Turbopack when it tries to read it as text. We don't need library source maps.
    turbopackInputSourceMaps: false,
  },
};

export default nextConfig;
