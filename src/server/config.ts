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
  // Sound effects. ELEVENLAB_API_KEY is accepted as an alias.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLAB_API_KEY: z.string().optional(),
  ELEVENLABS_BASE_URL: z.url().default("https://api.elevenlabs.io/v1"),
  ELEVENLABS_SOUND_MODEL: z.string().min(1).default("eleven_text_to_sound_v2"),
}).parse(process.env);
export const config = {
  apiKey: env.MUSE_API_KEY, baseUrl: env.MUSE_BASE_URL.replace(/\/$/, ""),
  chatModel: env.MUSE_CHAT_MODEL, imageModel: env.MUSE_IMAGE_MODEL,
  dataDir: resolve(env.CHAR2D_DATA_DIR), maxParallelImageJobs: env.CHAR2D_MAX_PARALLEL_IMAGE_JOBS,
  fakeAI: env.CHAR2D_FAKE_AI === "1",
  elevenLabsKey: env.ELEVENLABS_API_KEY || env.ELEVENLAB_API_KEY || "", elevenLabsBaseUrl: env.ELEVENLABS_BASE_URL.replace(/\/$/, ""), soundModel: env.ELEVENLABS_SOUND_MODEL,
};
