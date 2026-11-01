import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MuseProvider } from "../src/server/ai/muse";
import { config } from "../src/server/config";
import { getDatabase } from "../src/server/db";
import { saveAsset } from "../src/server/storage/assets";

async function main() {
  if (!config.apiKey) throw new Error("MUSE_API_KEY is missing from .env.local.");
  const prompt = process.argv.slice(2).join(" ").trim() ||
    "Create a clean anime-inspired pixel-art character turnaround sheet for a 2D game: an original cheerful adventurer with short teal hair, a navy jacket, cream trousers, and brown boots. Exactly three full-body neutral standing poses, left to right: facing right, front view, back view. Crisp square pixels, chibi proportions, limited palette, dark outline, no antialiasing, no text. Identical scale, evenly spaced, feet on the same baseline, generous padding. Perfectly flat solid magenta #FF00FF background. Do not use magenta on the character.";
  console.log(`Generating one image with ${config.imageModel} (real Muse API, regardless of fake mode)…`);
  const result = await new MuseProvider().generate({ prompt, size: [1536, 1024] });
  const metadata = await sharp(result.png).metadata();
  if (metadata.format !== "png") throw new Error("Expected PNG output from Muse.");
  const asset = await saveAsset(result.png, {
    kind: "muse-test", mime: "image/png", width: metadata.width, height: metadata.height,
  });
  const directory = join(config.dataDir, "muse");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "latest.png"), result.png);
  await writeFile(join(directory, `${asset.id}.response.json`), JSON.stringify(result.raw));
  await writeFile(join(directory, `${asset.id}.request.json`), JSON.stringify({
    model: config.imageModel, prompt, requestedSize: [1536, 1024],
    width: metadata.width, height: metadata.height, assetId: asset.id,
  }, null, 2));
  console.log(JSON.stringify({
    image: join(directory, "latest.png"), assetUrl: `/api/assets/${asset.id}`,
    width: metadata.width, height: metadata.height, bytes: result.png.length,
  }, null, 2));
}
main().catch(error => {
  // Never print request headers or environment variables.
  const message = error instanceof Error ? error.message : "Image generation failed";
  console.error(config.apiKey ? message.split(config.apiKey).join("[REDACTED]") : message);
  process.exitCode = 1;
}).finally(() => getDatabase().sqlite.close());
