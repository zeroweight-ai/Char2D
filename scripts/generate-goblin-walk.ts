// One real Muse image generation. Existing raw output is reprocessed for free.
// node --conditions=react-server --import tsx scripts/generate-goblin-walk.ts
// Add --force for a new paid generation; --process-only never calls Muse.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MuseProvider } from "../src/server/ai/muse";
import { config } from "../src/server/config";
import { getDatabase } from "../src/server/db";
import { cleanSpriteAlpha, removeChroma } from "../src/server/pixel/chroma";
import { extractPoses } from "../src/server/pipeline/frames";
import { stripGuide } from "../src/server/pipeline/guides";
import { preserveNativeFrames } from "../src/server/pipeline/native-frames";
import { stripPrompt } from "../src/server/pipeline/prompts/strip";
import { walkPoses } from "../src/server/pipeline/prompts/walk";

async function main() {
  const args = new Set(process.argv.slice(2));
  const rawDirectory = join(config.dataDir, "goblin-soldier");
  const outputDirectory = join(process.cwd(), "public", "worlds", "goblin-soldier");
  const source = join(config.dataDir, "assets", "map", "Pixel Goblin Brute with Spiked Mace.png");
  const rawPath = join(rawDirectory, "walk-raw.png");
  const key = "#FF00FF";
  await mkdir(rawDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  let png: Buffer;
  if (existsSync(rawPath) && !args.has("--force")) {
    console.log("Reprocessing saved Goblin Soldier walk strip; no Muse calls.");
    png = await readFile(rawPath);
  } else {
    if (args.has("--process-only")) throw new Error("No saved goblin strip to reprocess.");
    if (!config.apiKey) throw new Error("MUSE_API_KEY is missing from .env.local.");
    const reference = await sharp(await readFile(source)).flop().resize({ height: 384, kernel: "nearest" }).flatten({ background: key }).png().toBuffer();
    const size = await sharp(reference).metadata();
    const guide = await stripGuide(4, key, { width: size.width!, height: size.height! }, "standard", "left");
    const prompt = stripPrompt({ label: "Goblin Soldier Walk", actionKey: "walk", direction: "left", poses: walkPoses, key, segment: 0, total: 4, referenceWidth: size.width, referenceHeight: size.height, playback: "loop" }) +
      "\nNPC IDENTITY: This is the supplied goblin soldier, not a new character. Preserve his green skin, white ponytail and goatee, pointed ears and gold earrings, red neck cloth, scar, steel spiked armor, belt and boots, and the COMPLETE spiked mace. Walk toward screen-left in every frame. Carry the mace passively; no attacking. Ignore stray background speckles in the reference. Exactly four clearly different walking poses in one horizontal row, generous magenta gaps, equal scale, full mace and feet visible. No text or ground shadows.";
    await writeFile(join(rawDirectory, "reference-left.png"), reference);
    await writeFile(join(rawDirectory, "walk.request.json"), JSON.stringify({ source, model: config.imageModel, size: [2048, 512], prompt }, null, 2));
    console.log(`Generating Goblin Soldier walk: one real ${config.imageModel} image call…`);
    const result = await new MuseProvider().generate({ prompt, references: [reference, guide], size: [2048, 512] });
    png = result.png;
    await writeFile(rawPath, png);
    await writeFile(join(rawDirectory, "walk.usage.json"), JSON.stringify(result.usage ?? null, null, 2));
    console.log("Muse walk strip saved; extracting four transparent frames.");
  }
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const keyed = cleanSpriteAlpha(removeChroma(data, info.width, info.height, key).rgba);
  const transparent = await sharp(keyed, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const { poses, warnings } = await extractPoses(transparent, 4);
  const heights = poses.map(pose => pose.rect.h);
  if (Math.max(...heights) / Math.min(...heights) > 1.2) throw new Error("Goblin frame heights differ by more than 20%; inspect the raw strip before publishing.");
  const frames = await preserveNativeFrames(poses.map(pose => ({ ...pose, scale: 1, baseline: pose.rect.y + pose.rect.h, airborne: false })));
  const width = frames.reduce((sum, frame) => sum + frame.w, 0), height = Math.max(...frames.map(frame => frame.h));
  let offset = 0;
  const packed = frames.map(frame => {
    const result = { x: offset, y: 0, w: frame.w, h: frame.h, anchorX: frame.anchorX, anchorY: frame.anchorY, durationMs: 140 };
    offset += frame.w;
    return result;
  });
  const atlas = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(frames.map((frame, index) => ({ input: frame.png, left: packed[index].x, top: 0 }))).png().toBuffer();
  await writeFile(join(outputDirectory, "walk.png"), atlas);
  await writeFile(join(outputDirectory, "walk.json"), JSON.stringify({ name: "Goblin Soldier", direction: "left", atlas: { url: "/worlds/goblin-soldier/walk.png", width, height }, frames: packed, model: config.imageModel, source: "Pixel Goblin Brute with Spiked Mace.png", warnings }, null, 2));
  console.log(JSON.stringify({ atlas: join(outputDirectory, "walk.png"), width, height, frameCount: frames.length, warnings }, null, 2));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Goblin walk generation failed";
  console.error(config.apiKey ? message.split(config.apiKey).join("[REDACTED]") : message);
  process.exitCode = 1;
}).finally(() => getDatabase().sqlite.close());
