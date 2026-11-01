import { defineConfig } from "drizzle-kit";
import { config } from "./src/server/config";
import { join } from "node:path";
export default defineConfig({ dialect: "sqlite", schema: "./src/server/db/schema.ts", out: "./drizzle", dbCredentials: { url: join(config.dataDir, "char2d.db") } });
