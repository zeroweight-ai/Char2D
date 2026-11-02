// Builds transparent brand assets from media/logo_high.png (logo on white).
// Usage: npm run brand:build
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "media/logo_high.png";
const OUT = "public/brand";

// Removes only the white paper: low-saturation light pixels connected to the
// border or to pure-white seeds in the wordmark (holes in "a" and "D").
// Paper pixels get "un-multiplied" alpha so soft edges stay clean on any
// background; everything else (skin, highlights) stays fully opaque.
async function removeWhite() {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, count = width * height;
  const min = (i: number) => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  const max = (i: number) => Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  const candidate = (i: number) => min(i) >= 200 && max(i) - min(i) <= 24;
  const paper = new Uint8Array(count), stack: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = i % width, y = (i / width) | 0;
    // Interior seeds only in the wordmark band (y ≥ 690), so the mascot's white
    // highlights are never treated as paper.
    const seed = (x === 0 || y === 0 || x === width - 1 || y === height - 1 || (y >= 690 && min(i) >= 250)) && candidate(i);
    if (seed) { paper[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!, x = i % width;
    for (const n of [i - width, i + width, x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1])
      if (n >= 0 && n < count && !paper[n] && candidate(n)) { paper[n] = 1; stack.push(n); }
  }
  const out = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]], q = i * 4;
    if (!paper[i]) { out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = 255; continue; }
    const a = min(i) >= 246 ? 0 : Math.min(1, ((255 - min(i)) / 255) * 1.6);
    if (a <= 0.02) continue;
    out[q] = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - a)) / a)));
    out[q + 1] = Math.max(0, Math.min(255, Math.round((g - 255 * (1 - a)) / a)));
    out[q + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - a)) / a)));
    out[q + 3] = Math.round(a * 255);
  }
  return { png: await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer(), info };
}

async function crop(png: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const piece = await sharp(png).extract(region).png().toBuffer();
  return sharp(piece).trim({ threshold: 1 }).png().toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { png, info } = await removeWhite();
  const full = await sharp(png).trim({ threshold: 1 }).png().toBuffer();
  // Regions measured on the 1254×1254 source.
  const mascot = await crop(png, { left: 300, top: 190, width: 720, height: 495 });
  const wordmark = await crop(png, { left: 120, top: 690, width: info.width - 240, height: 330 });
  const hero = await crop(png, { left: 470, top: 200, width: 330, height: 485 }); // character only, no sparkles/pencil

  const write = async (name: string, buffer: Buffer, width: number) => {
    const resized = await sharp(buffer).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    await sharp(resized).toFile(`${OUT}/${name}`);
    const meta = await sharp(resized).metadata();
    console.log(`✓ ${OUT}/${name} ${meta.width}×${meta.height}`);
  };
  await write("logo-full.png", full, 900);
  await write("logo-mascot.png", mascot, 480);
  await write("logo-wordmark.png", wordmark, 900);
  await write("logo-hero.png", hero, 256);
  // App icon: hero on a transparent square canvas.
  const icon = await sharp(hero).resize({ width: 224, height: 224, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp(icon).toFile("src/app/icon.png");
  console.log("✓ src/app/icon.png 256×256");
}
void main();
