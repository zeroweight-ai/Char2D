import sharp from "sharp";

// Cheap, deterministic sanity checks on extracted poses. They catch failure
// modes Muse shows on split (multi-batch) strips: a batch drawn at a different
// scale (handled in the strip loop), and a walk "contact B" frame that
// repeats "contact A" instead of swapping legs.

type Rgb = [number, number, number];
/**
 * Average colour of the front-most and rear-most foot: opaque pixels in the
 * bottom 10% of the pose, front/rear quarter of that band's horizontal extent.
 * "front" is the facing direction (right unless facing left).
 */
export async function footColors(png: Buffer, facing: "left" | "right" = "right"): Promise<{ front: Rgb; rear: Rgb } | null> {
  const { data, info } = await sharp(png).ensureAlpha().trim({ threshold: 1 }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, top = Math.floor(height * 0.9);
  let minX = width, maxX = -1;
  for (let y = top; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 127) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  if (maxX - minX < 4) return null;
  const quarter = Math.max(1, Math.round((maxX - minX + 1) / 4));
  const average = (from: number, to: number): Rgb | null => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = top; y < height; y++) for (let x = from; x <= to; x++) {
      const i = (y * width + x) * 4;
      // Skip outline pixels so the shoe colour dominates.
      if (data[i + 3] > 127 && data[i] + data[i + 1] + data[i + 2] > 90) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    }
    return n ? [r / n, g / n, b / n] : null;
  };
  const right = average(maxX - quarter + 1, maxX), left = average(minX, minX + quarter - 1);
  if (!right || !left) return null;
  return facing === "right" ? { front: right, rear: left } : { front: left, rear: right };
}
const rgbDistance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * True when frame B keeps frame A's leg order (same foot in front) even though
 * the two feet are visually distinguishable — i.e. a contact pose that should
 * have swapped legs but did not. Returns false when feet look alike (unknowable).
 */
export async function sameLegOrder(a: Buffer, b: Buffer, facing: "left" | "right" = "right", minContrast = 40) {
  const [fa, fb] = await Promise.all([footColors(a, facing), footColors(b, facing)]);
  if (!fa || !fb || rgbDistance(fa.front, fa.rear) < minContrast) return false;
  const keep = rgbDistance(fa.front, fb.front) + rgbDistance(fa.rear, fb.rear);
  const swap = rgbDistance(fa.front, fb.rear) + rgbDistance(fa.rear, fb.front);
  return keep < swap;
}
