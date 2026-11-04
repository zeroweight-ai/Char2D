import type { NextConfig } from "next";
const config: NextConfig = {
  // Playwright runs another dev server; its compiler must not overwrite the app's chunks.
  distDir: process.env.CHAR2D_E2E === "1" ? ".next-e2e" : ".next",
  serverExternalPackages: ["better-sqlite3", "sharp"],
};
export default config;
