import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained build in .next/standalone so the Docker image
  // only needs the server bundle + node runtime (much smaller image).
  output: "standalone",
};

export default nextConfig;
