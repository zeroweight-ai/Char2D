import { expect, it } from "vitest";
import { WorldInteractions } from "../src/lib/game/interactions";
import type { WorldMap } from "../src/lib/game/world";
import { GoblinSoldier } from "../src/lib/game/goblin";

const world: WorldMap = {
  width: 1000, height: 1000, spawn: { x: 100, y: 800 }, hazards: [],
  platforms: [{ id: "floor", left: 0, right: 1000, top: 800, bottom: 1000 }],
  coins: [{ id: "first", x: 100, y: 700, value: 1 }, { id: "airborne", x: 500, y: 400, value: 2 }],
  chests: [{ id: "treasure", left: 300, right: 400, top: 720, bottom: 800, coins: 10 }],
};

it("collects touching coins once, including during a jump, and ignores distant coins", () => {
  const items = new WorldInteractions(world);
  items.step(16, 100, 800);
  expect(items.coinCount).toBe(1);
  expect(items.coins.has("first")).toBe(false);
  items.step(32, 100, 800);
  expect(items.coinCount).toBe(1);
  items.step(48, 500, 470);
  expect(items.coinCount).toBe(3);
  expect(items.coins.size).toBe(0);
  expect(items.collectedCoins.size).toBe(2);
});

it("requires a timed attack before a chest breaks, then drops ten collectible coins", () => {
  const items = new WorldInteractions(world);
  items.step(0, 350, 800);
  expect(items.destroyedChests.size).toBe(0);
  expect(items.startAttack(0, "right")).toBe(true);
  items.step(40, 250, 800);
  expect(items.destroyedChests.size).toBe(0);
  items.step(80, 250, 800);
  expect(items.destroyedChests.has("treasure")).toBe(true);
  expect(items.coinCount).toBe(0);
  expect([...items.coins.keys()].filter(id => id.startsWith("treasure:loot:"))).toHaveLength(10);
  items.step(100, 350, 800);
  expect(items.coinCount).toBe(10);
  items.step(150, 350, 800);
  expect(items.coinCount).toBe(10);
});

it("respects attack facing, horizontal range, vertical overlap and its cooldown", () => {
  for (const [x, y, direction] of [[250, 800, "left"], [100, 800, "right"], [250, 450, "right"]] as const) {
    const items = new WorldInteractions(world);
    items.startAttack(0, direction);
    items.step(100, x, y);
    expect(items.destroyedChests.size).toBe(0);
    expect(items.startAttack(200, "right")).toBe(false);
    expect(items.startAttack(400, "right")).toBe(true);
    items.step(480, 250, 800);
    expect(items.destroyedChests.size).toBe(1);
  }
});

it("cannot farm a destroyed chest by repeating attacks or canceling a swing", () => {
  const items = new WorldInteractions(world);
  items.startAttack(0, "right");
  items.step(80, 250, 800);
  items.step(100, 350, 800);
  for (let time = 400; time <= 1600; time += 400) {
    items.startAttack(time, "right");
    items.step(time + 100, 350, 800);
    items.cancelAttack();
  }
  expect(items.coinCount).toBe(10);
  expect(items.destroyedChests.size).toBe(1);
  expect(items.coins.has("airborne")).toBe(true);
});

it("cancels pending attack damage when focus is lost", () => {
  const items = new WorldInteractions(world);
  items.startAttack(0, "right");
  items.cancelAttack();
  items.step(100, 350, 800);
  expect(items.destroyedChests.size).toBe(0);
  expect(items.attackProgress).toBe(null);
});

it("waits for treasure loot as well as map coins before reporting completion", () => {
  const items = new WorldInteractions(world);
  expect(items.totalCoins).toBe(13);
  items.step(16, 100, 800);
  items.step(32, 500, 470);
  expect(items.coins.size).toBe(0);
  expect(items.allCoinsCollected).toBe(false);
  items.startAttack(400, "right");
  items.step(480, 250, 800);
  expect(items.allCoinsCollected).toBe(false);
  items.step(500, 350, 800);
  expect(items.coinCount).toBe(13);
  expect(items.allCoinsCollected).toBe(true);
  expect(new WorldInteractions({ ...world, coins: [], chests: [] }).allCoinsCollected).toBe(false);
});

it("counts one goblin hit per swing and requires three separate attacks", () => {
  const items = new WorldInteractions(world), goblin = new GoblinSoldier(world);
  goblin.step(16, true);
  goblin.x = 350;
  for (const [time, health] of [[0, 2], [400, 1], [800, 0]]) {
    expect(items.startAttack(time, "right")).toBe(true);
    for (const age of [60, 80, 100, 150, 220]) {
      items.step(time + age, 250, 800, goblin);
      expect(goblin.health).toBe(health);
    }
  }
  expect(goblin.defeated).toBe(true);
  expect(goblin.active).toBe(false);
});

it("does not damage the goblin when the attack faces away, is too far away or is above it", () => {
  for (const [x, y, direction] of [[250, 800, "left"], [100, 800, "right"], [250, 400, "right"]] as const) {
    const items = new WorldInteractions(world), goblin = new GoblinSoldier(world);
    goblin.step(16, true);
    goblin.x = 350;
    items.startAttack(0, direction);
    items.step(100, x, y, goblin);
    expect(goblin.health).toBe(3);
  }
});
