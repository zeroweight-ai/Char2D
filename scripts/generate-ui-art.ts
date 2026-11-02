// Generates the game-style UI art in public/game/ with Muse Image.
// Usage: npm run art:generate -- [name ...]   (no names = all missing images)
// Pass --force to regenerate images that already exist. Each image is one paid Muse call.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";

loadEnvConfig(process.cwd());
const apiKey = process.env.MUSE_API_KEY ?? "";
const baseUrl = (process.env.MUSE_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/$/, "");
const model = process.env.MUSE_IMAGE_MODEL ?? "muse-image-1.0";
const outDir = join(process.cwd(), "public", "game");
const rawDir = join(process.cwd(), process.env.CHAR2D_DATA_DIR ?? "data", "ui-art");

const STYLE = "Crisp 16-bit pixel art, clean square pixels, no anti-aliasing, bright cheerful palette, sky blues, lush greens, warm browns, soft cel shading, no text, no letters, no logos, no UI, no watermark.";
// Sprites are drawn on flat magenta and keyed out locally.
const KEY = "Perfectly flat solid magenta #FF00FF background filling the whole image. Do not use magenta or pink anywhere on the subject. Generous empty padding around the subject.";

type Art = { name: string; size: [number, number]; prompt: string; key?: boolean; width?: number };
const ART: Art[] = [
  { name: "title-world", size: [1536, 1024], width: 1920,
    prompt: `Wide side-view 2D platformer game title screen landscape. ${STYLE} Bright blue sky gradient with fluffy layered pixel clouds filling the top two thirds, which stays open and empty for a title. Along the bottom fifth: chunky floating grassy dirt platforms of different heights, small wooden scaffold bridges, a shallow blue water gap, wooden crates, a little wooden signpost, a few small bushes and grass tufts. A large leafy oak tree on the far left edge and another on the far right edge, framing the scene, with faint ruined stone towers in the distance behind them. No characters, no creatures.` },
  { name: "summon-shrine", size: [1536, 1024], width: 1600,
    prompt: `Side-view 2D game scene of a magical character-creation shrine on a grassy hilltop. ${STYLE} Daytime blue sky with soft pixel clouds. In the centre bottom, an ancient round stone summoning platform with glowing teal runes and a faint column of sparkling cyan light rising from it, empty, waiting for a hero. Small floating crystals, mossy stone pillars on both sides, flowers and grass around the base. Lots of calm sky in the upper half. No characters.` },
  { name: "arena", size: [1536, 1024], width: 1536,
    prompt: `Simple side-scroller game training-ground background for showing a character sprite. ${STYLE} Soft light blue sky with a few distant pixel clouds, gentle rolling green hills and tiny distant trees in parallax layers in the middle, and a flat grassy dirt ground strip across the bottom 18% of the image, with a straight flat top edge. Keep the centre very calm, low detail and uncluttered so a character standing on the ground reads clearly. No characters, no objects in the centre.` },
  { name: "world-map", size: [1536, 1024], width: 1536,
    prompt: `Top-down 2D RPG overworld map. ${STYLE} A small island continent surrounded by blue ocean: green meadows, a winding dirt path, a pine forest, a small village of tiny houses, a mountain range, a river with a bridge, a desert corner and a castle. Seen from directly above at a slight angle, JRPG style. No characters.` },
  { name: "sprite-fairy", size: [1024, 1024], key: true, width: 256,
    prompt: `A single small cute pixel-art fairy guide sprite for a 2D game, flying, facing left: a tiny hooded figure with a teal cloak, big glowing eyes and two large translucent pale-blue insect wings, with a few sparkle pixels around it. ${STYLE} Bold dark outline. Centered, full body. ${KEY}` },
  { name: "sprite-chest", size: [1024, 1024], key: true, width: 192,
    prompt: `A single pixel-art wooden treasure chest sprite for a 2D game, lid slightly open with golden glow and coins peeking out, three-quarter front view. ${STYLE} Bold dark outline. Centered. ${KEY}` },
];

async function generate(art: Art) {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: art.prompt, n: 1, size: `${art.size[0]}x${art.size[1]}`, output_format: "png", response_format: "b64_json" }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json() as { data?: { b64_json?: string }[]; error?: { message?: string } };
  const b64 = body.data?.[0]?.b64_json;
  if (!response.ok || !b64) throw new Error(body.error?.message ?? `Muse HTTP ${response.status}`);
  return Buffer.from(b64, "base64");
}

// Removes the magenta key colour and trims to the sprite's bounding box.
async function keyOut(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const magenta = r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90;
    const fringe = r > 120 && b > 120 && g < r * 0.6 && g < b * 0.6;
    if (magenta || fringe) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().trim().toBuffer();
}

async function main() {
  if (!apiKey) throw new Error("MUSE_API_KEY is missing from .env / .env.local.");
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const wanted = args.filter(arg => !arg.startsWith("--"));
  await mkdir(outDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  const queue = ART.filter(art => (!wanted.length || wanted.includes(art.name)) && (force || !existsSync(join(outDir, `${art.name}.png`))));
  await Promise.all(queue.map(async art => {
    console.log(`→ ${art.name}: generating with ${model}…`);
    try {
      let png = await generate(art);
      await writeFile(join(rawDir, `${art.name}.png`), png);
      if (art.key) png = await keyOut(png);
      const resized = await sharp(png).resize({ width: art.width, kernel: art.key ? "nearest" : "lanczos3", withoutEnlargement: false }).png({ compressionLevel: 9, palette: !art.key }).toBuffer();
      await writeFile(join(outDir, `${art.name}.png`), resized);
      const meta = await sharp(resized).metadata();
      console.log(`✓ ${art.name}.png ${meta.width}×${meta.height} ${(resized.length / 1024).toFixed(0)} KB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      console.error(`✗ ${art.name}: ${message.split(apiKey).join("[REDACTED]")}`);
      process.exitCode = 1;
    }
  }));
}
void main();
