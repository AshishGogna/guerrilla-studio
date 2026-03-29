import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Allow large editor clip uploads (defaults ~10MB is too small for long video).
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
