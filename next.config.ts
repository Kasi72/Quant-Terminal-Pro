import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Baked into both client and server bundles; an open tab compares its own id with the
  // server's (/api/version) to detect that a newer deployment is live.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_DEPLOYMENT_ID ?? `local-${Date.now()}`,
  },
};

export default nextConfig;
