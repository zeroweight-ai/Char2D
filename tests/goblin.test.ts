import { expect, it } from "vitest";
import { GoblinSoldier, GOBLIN_WALK_SPEED } from "../src/lib/game/goblin";
import { VILLAGE_MAP, WORLD_GROUND } from "../src/lib/game/world";

it("waits for all coins before entering from outside the right edge", () => {
  const goblin = new GoblinSoldier(VILLAGE_MAP);
  goblin.step(3000, false);
  expect(goblin.spawned).toBe(false);
  expect(goblin.active).toBe(false);
  goblin.step(16, true);
  expect(goblin.spawned).toBe(true);
  expect(goblin.active).toBe(true);
  expect(goblin.x).toBeGreaterThan(VILLAGE_MAP.width);
  expect(goblin.y).toBe(767);
  const start = goblin.x;
  goblin.step(1000, true);
  expect(goblin.x).toBeCloseTo(start - GOBLIN_WALK_SPEED);
});

it("walks over the road and log bridge and waits at the left edge to be defeated", () => {
  const goblin = new GoblinSoldier(VILLAGE_MAP);
  goblin.step(16, true);
  goblin.step(3000, true);
  expect(goblin.x).toBeCloseTo(1432);
  expect(goblin.y).toBe(767);
  goblin.step(1000, true);
  expect(goblin.x).toBeCloseTo(1292);
  expect(goblin.y).toBeGreaterThan(760);
  goblin.step(2000, true);
  expect(goblin.x).toBeCloseTo(1012);
  expect(goblin.y).toBe(WORLD_GROUND);
  goblin.step(10_000, true);
  expect(goblin.active).toBe(true);
  expect(goblin.x).toBe(180);
  expect(goblin.arrived).toBe(true);
  const finishedX = goblin.x;
  goblin.step(10_000, true);
  expect(goblin.x).toBe(finishedX);
  expect(goblin.spawned).toBe(true);
});

it("takes three hits to vanish and cannot take hits before spawning or after defeat", () => {
  const goblin = new GoblinSoldier(VILLAGE_MAP);
  expect(goblin.takeHit()).toBe(false);
  goblin.step(16, true);
  expect(goblin.health).toBe(3);
  expect(goblin.takeHit()).toBe(true);
  expect(goblin.health).toBe(2);
  const x = goblin.x;
  goblin.step(200, true);
  expect(goblin.x).toBe(x);
  goblin.step(200, true);
  expect(goblin.x).toBeLessThan(x);
  expect(goblin.takeHit()).toBe(true);
  expect(goblin.defeated).toBe(false);
  expect(goblin.takeHit()).toBe(true);
  expect(goblin.health).toBe(0);
  expect(goblin.defeated).toBe(true);
  expect(goblin.active).toBe(false);
  expect(goblin.takeHit()).toBe(false);
  goblin.step(10_000, true);
  expect(goblin.active).toBe(false);
});

it("walks at the same speed with different render frame sizes", () => {
  const small = new GoblinSoldier(VILLAGE_MAP), large = new GoblinSoldier(VILLAGE_MAP);
  small.step(16, true);
  large.step(16, true);
  for (let frame = 0; frame < 60; frame++) small.step(1000 / 60, true);
  large.step(1000, true);
  expect(small.x).toBeCloseTo(large.x, 6);
  expect(small.y).toBeCloseTo(large.y, 6);
  expect(small.elapsedMs).toBeCloseTo(large.elapsedMs, 6);
});
