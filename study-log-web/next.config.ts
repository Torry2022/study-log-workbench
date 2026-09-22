import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/study-log",
  distDir: process.env.NODE_ENV === "development" ? ".next-dev-cache" : ".next-build-cache",
  output: "standalone",
  // PDF.js loads its worker and text resources relative to its installed package.
  serverExternalPackages: ["pdfjs-dist", "mammoth"],
  outputFileTracingIncludes: {
    "/api/materials/extract": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/package.json"
    ]
  }
};

export default nextConfig;
