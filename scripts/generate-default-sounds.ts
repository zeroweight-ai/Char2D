// Generates the bundled default move sounds in public/sounds/ with ElevenLabs.
// Usage: npm run sounds:generate -- [walk|jump|crouch ...]  (no names = all missing)
// Pass --force to regenerate existing files. Each sound is one paid ElevenLabs call.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { DEFAULT_SOUNDS } from "../src/lib/default-sounds";

loadEnvConfig(process.cwd());
const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVENLAB_API_KEY || "";
const baseUrl = (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io/v1").replace(/\/$/, "");
const model = process.env.ELEVENLABS_SOUND_MODEL ?? "eleven_text_to_sound_v2";
const args = process.argv.slice(2), force = args.includes("--force"), names = args.filter(arg => !arg.startsWith("--"));
if (!key) { console.error("Set ELEVENLAB_API_KEY (or ELEVENLABS_API_KEY) in .env"); process.exit(1); }
async function main() {
await mkdir(join(process.cwd(), "public", "sounds"), { recursive: true });
let calls = 0;
for (const [name, sound] of Object.entries(DEFAULT_SOUNDS)) {
  if (names.length && !names.includes(name)) continue;
  const file = join(process.cwd(), "public", sound.url);
  if (existsSync(file) && !force) { console.log(`skip ${name} (exists)`); continue; }
  const response = await fetch(`${baseUrl}/sound-generation?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: sound.prompt, duration_seconds: sound.durationSeconds, prompt_influence: 0.6, model_id: model }) });
  calls++;
  if (!response.ok) { console.error(`${name}: ElevenLabs HTTP ${response.status} ${await response.text()}`); process.exitCode = 1; continue; }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(file, bytes);
  console.log(`wrote ${sound.url} (${bytes.length} bytes)`);
}
console.log(`${calls} ElevenLabs call(s).`);
}
void main();
