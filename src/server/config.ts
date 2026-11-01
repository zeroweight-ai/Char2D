import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { z } from "zod";
loadEnvConfig(process.cwd());
const env = z.object({
  MUSE_API_KEY: z.string().default(""),
  MUSE_BASE_URL: z.url().default("https://api.meta.ai/v1"),
  MUSE_CHAT_MODEL: z.string().min(1).default("muse-spark-1.3"),
  MUSE_IMAGE_MODEL: z.string().min(1).default("muse-image-1.0"),
  CHAR2D_DATA_DIR: z.string().min(1).default("./data"),
  CHAR2D_MAX_PARALLEL_IMAGE_JOBS: z.coerce.number().int().min(1).max(10).default(2),
  CHAR2D_FAKE_AI: z.enum(["0", "1"]).default("1"),
}).parse(process.env);
export const config = {
  apiKey: env.MUSE_API_KEY, baseUrl: env.MUSE_BASE_URL.replace(/\/$/, ""),
  chatModel: env.MUSE_CHAT_MODEL, imageModel: env.MUSE_IMAGE_MODEL,
  dataDir: resolve(env.CHAR2D_DATA_DIR), maxParallelImageJobs: env.CHAR2D_MAX_PARALLEL_IMAGE_JOBS,
  fakeAI: env.CHAR2D_FAKE_AI === "1",
};
