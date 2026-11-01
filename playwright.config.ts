import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "npx concurrently --kill-others \"next dev --hostname 127.0.0.1 --port 3100\" \"tsx --conditions=react-server src/worker/index.ts\"",
    url: "http://127.0.0.1:3100", reuseExistingServer: false,
    env: { CHAR2D_FAKE_AI: "1", CHAR2D_DATA_DIR: "./data/e2e" },
    timeout: 120_000,
  },
});
