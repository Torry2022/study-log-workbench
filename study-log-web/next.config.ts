import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/study-log",
  distDir: process.env.NODE_ENV === "development" ? ".next-dev-cache" : ".next-build-cache",
  output: "standalone"
};

export default nextConfig;
