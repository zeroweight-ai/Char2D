import walk from "../../../public/worlds/goblin-soldier/walk.json";
import { frameAtTime } from "../anim/timeline";
import { GOBLIN_HEIGHT, type GoblinSoldier } from "./goblin";

export const GOBLIN_WALK_URL = walk.atlas.url;
const durations = walk.frames.map(frame => frame.durationMs);
const zoom = GOBLIN_HEIGHT / Math.max(...walk.frames.map(frame => frame.anchorY));

export function drawGoblin(context: CanvasRenderingContext2D, image: HTMLImageElement, goblin: GoblinSoldier) {
  context.clearRect(0, 0, goblin.world.width, goblin.world.height);
  if (!goblin.active || !image.complete || !image.naturalWidth) return null;
  const { index } = frameAtTime(durations, goblin.elapsedMs, "loop");
  const frame = walk.frames[index];
  context.save();
  if (goblin.hurtTimeMs > 0 && Math.floor(goblin.hurtTimeMs / 60) % 2) context.globalAlpha = 0.4;
  context.imageSmoothingEnabled = false;
  context.translate(goblin.x, goblin.y);
  context.scale(zoom, zoom);
  context.drawImage(image, frame.x, frame.y, frame.w, frame.h, -frame.anchorX, -frame.anchorY, frame.w, frame.h);
  context.restore();
  return index;
}
