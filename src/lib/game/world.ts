export const WORLD_WIDTH = 1672, WORLD_HEIGHT = 941, WORLD_GROUND = 740;
export const HERO_HEIGHT = 234, HERO_HALF_WIDTH = 26;
export type BodyShape = { halfWidth: number; height: number };
export const HERO_BODY: BodyShape = { halfWidth: HERO_HALF_WIDTH, height: HERO_HEIGHT };

export type Platform = {
  id: string;
  left: number;
  right: number;
  top: number;
  /** Omit for a ledge that can be jumped through from below. */
  bottom?: number;
};
export type Ladder = { id: string; left: number; right: number; top: number; bottom: number };
export type Coin = { id: string; x: number; y: number; value: number };
export type TreasureChest = { id: string; left: number; right: number; top: number; bottom: number; coins: number };
export type WorldMap = {
  width: number;
  height: number;
  spawn: { x: number; y: number };
  platforms: readonly Platform[];
  ladders?: readonly Ladder[];
  coins?: readonly Coin[];
  chests?: readonly TreasureChest[];
  hazards: readonly { left: number; right: number; top: number; bottom: number }[];
};

// Coordinates are in village-platformer.png's native 1672 × 941 pixels.
// Floating grass ledges are one-way; the lower road foundations are solid.
// The broad road uses its walking lane; grass and logs use their top surfaces.
export const VILLAGE_MAP: WorldMap = {
  width: WORLD_WIDTH, height: WORLD_HEIGHT, spawn: { x: 260, y: WORLD_GROUND },
  platforms: [
    { id: "village-road", left: 0, right: 1094, top: WORLD_GROUND, bottom: WORLD_HEIGHT },
    { id: "road-step-1", left: 1094, right: 1122, top: 748, bottom: WORLD_HEIGHT },
    { id: "road-step-2", left: 1122, right: 1178, top: 756, bottom: WORLD_HEIGHT },
    { id: "road-step-3", left: 1178, right: 1190, top: 764, bottom: WORLD_HEIGHT },
    { id: "bridge-1", left: 1190, right: 1222, top: 760 },
    { id: "bridge-2", left: 1222, right: 1262, top: 774 },
    { id: "bridge-3", left: 1262, right: 1302, top: 780 },
    { id: "bridge-4", left: 1302, right: 1342, top: 774 },
    { id: "bridge-5", left: 1342, right: 1382, top: 760 },
    { id: "right-road", left: 1382, right: WORLD_WIDTH, top: 767, bottom: WORLD_HEIGHT },
    { id: "mushroom-ledge", left: 1350, right: WORLD_WIDTH, top: 636 },
    { id: "chicken-ledge", left: 1232, right: 1586, top: 485 },
    { id: "spike-ledge", left: 1033, right: 1244, top: 548 },
    { id: "garden-ledge", left: 540, right: 894, top: 431 },
    { id: "left-treasure-ledge", left: 302, right: 555, top: 338 },
    { id: "market-ledge", left: 650, right: 1036, top: 280 },
    { id: "house-ledge", left: 1080, right: 1438, top: 272 },
    { id: "right-treasure-ledge", left: 1438, right: 1643, top: 245 },
  ],
  ladders: [{ id: "pink-ladder", left: 1248, right: 1314, top: 272, bottom: 485 }],
  coins: [
    ...[500, 650, 800, 950, 1080].map((x, i) => ({ id: `road-coin-${i + 1}`, x, y: WORLD_GROUND - 56, value: 1 })),
    { id: "village-coin-1", x: 594, y: 352, value: 1 },
    { id: "village-coin-2", x: 594, y: 302, value: 1 },
    { id: "village-coin-3", x: 597, y: 254, value: 1 },
    { id: "village-coin-4", x: 630, y: 221, value: 1 },
    { id: "village-coin-5", x: 666, y: 200, value: 1 },
  ],
  chests: [
    { id: "left-treasure", left: 318, right: 423, top: 270, bottom: 335, coins: 10 },
    { id: "right-treasure", left: 1483, right: 1586, top: 181, bottom: 244, coins: 10 },
  ],
  hazards: [{ left: 1087, right: 1210, top: 518, bottom: 548 }],
};

export function overlapsPlatform(x: number, platform: Platform, halfWidth = HERO_HALF_WIDTH) {
  return x + halfWidth > platform.left && x - halfWidth < platform.right;
}

export function supportAt(world: WorldMap, x: number, y: number, shape = HERO_BODY, obstacles: readonly Platform[] = []) {
  const supports = (platform: Platform) => Math.abs(platform.top - y) < 0.01 && overlapsPlatform(x, platform, shape.halfWidth);
  return world.platforms.find(supports) ?? obstacles.find(supports);
}

/** Sweep a foot-anchored body, including action root motion, against map geometry. */
export function moveBody(world: WorldMap, x: number, y: number, dx: number, dy: number, grounded: boolean, shape = HERO_BODY, obstacles: readonly Platform[] = []) {
  const { halfWidth, height } = shape;
  const platforms = obstacles.length ? [...world.platforms, ...obstacles] : world.platforms;
  const insideSolid = (px: number, py: number, platform: Platform) => platform.bottom !== undefined &&
    py > platform.top && py - height < platform.bottom && overlapsPlatform(px, platform, halfWidth);
  // A respawn can place an actor inside another actor. Resolve that overlap
  // without pushing either body through terrain or outside the map.
  for (const obstacle of obstacles) {
    if (!insideSolid(x, y, obstacle)) continue;
    const candidates = [
      { x: obstacle.left - halfWidth, y }, { x: obstacle.right + halfWidth, y },
      { x, y: obstacle.top }, { x, y: obstacle.bottom! + height },
    ].filter(point => point.x >= halfWidth && point.x <= world.width - halfWidth && point.y >= height &&
      !platforms.some(platform => insideSolid(point.x, point.y, platform)));
    candidates.sort((a, b) => Math.abs(a.x - x) + Math.abs(a.y - y) - Math.abs(b.x - x) - Math.abs(b.y - y));
    if (candidates[0]) { x = candidates[0].x; y = candidates[0].y; }
  }
  const stepHeight = 24;
  let nextX = Math.max(halfWidth, Math.min(world.width - halfWidth, x + dx));
  // Small height changes on the log bridge should be walkable in either direction.
  const step = grounded && dy >= 0 ? platforms.filter(platform =>
    overlapsPlatform(nextX, platform, halfWidth) && platform.top < y && y - platform.top <= stepHeight &&
    !obstacles.some(obstacle => insideSolid(nextX, platform.top, obstacle)),
  ).sort((a, b) => a.top - b.top)[0] : undefined;
  if (step) y = step.top;
  for (const platform of platforms) {
    if (platform.bottom === undefined || y <= platform.top || y - height >= platform.bottom) continue;
    if (dx > 0 && x + halfWidth <= platform.left && nextX + halfWidth > platform.left) nextX = Math.min(nextX, platform.left - halfWidth);
    if (dx < 0 && x - halfWidth >= platform.right && nextX - halfWidth < platform.right) nextX = Math.max(nextX, platform.right + halfWidth);
  }
  let nextY = Math.max(height, y + dy);
  let hitCeiling = dy < 0 && nextY !== y + dy;
  let landing: Platform | undefined;
  for (const platform of platforms) {
    if (!overlapsPlatform(nextX, platform, halfWidth)) continue;
    if (dy >= 0 && y <= platform.top && nextY >= platform.top && (!landing || platform.top < landing.top)) landing = platform;
    if (dy < 0 && platform.bottom !== undefined && y - height >= platform.bottom && nextY - height < platform.bottom) {
      nextY = platform.bottom + height;
      hitCeiling = true;
    }
  }
  if (landing) nextY = landing.top;
  return { x: nextX, y: nextY, grounded: !!landing, hitCeiling };
}
