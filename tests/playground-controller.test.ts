import { expect, it } from "vitest";
import type { Manifest } from "../src/lib/manifest";
import { WorldController, WORLD_GROUND } from "../src/lib/game/controller";
import { HERO_HEIGHT, HERO_HALF_WIDTH, moveBody, VILLAGE_MAP, type WorldMap } from "../src/lib/game/world";
import { GOBLIN_HALF_WIDTH } from "../src/lib/game/goblin";

function setup() {
  const action = (trigger: "hold" | "press" | "toggle", extra = {}) => ({
    label: "Action", playback: "loop" as const,
    directions: { right: { frames: [{ x: 0, y: 0, w: 32, h: 48, anchorX: 16, anchorY: 48, durationMs: 200 }] }, left: { mirrorOf: "right" as const } },
    gameplay: { trigger, lockMovement: false, interruptible: true, ...extra },
  });
  const manifest: Manifest = {
    version: 1, characterId: "hero", viewType: "side_scroller", pixelScale: 1,
    atlas: { url: "/atlas.png", width: 32, height: 48, version: 1 },
    actions: { idle: action("hold"), walk: action("hold"), jump: action("press"),
      fireball: action("press", { lockMovement: true, cooldownMs: 500 }),
      shield: action("hold"), aura: action("toggle"),
      dash: action("press", { lockMovement: true, interruptible: false, rootMotion: { dx: 80, dy: 0, overMs: 200 } }),
    },
  };
  const controller = new WorldController(manifest, { p1: { fireball: ["KeyJ"], shield: ["KeyK"], jump: [] }, p2: { aura: ["Numpad1"] } });
  return controller;
}

it("finishes one press cycle, respects its movement lock and cooldown, then resumes held movement", () => {
  const controller = setup();
  controller.downKey("KeyD");
  controller.downKey("KeyJ");
  const x = controller.x;
  controller.step(100);
  expect(controller.action).toBe("fireball");
  expect(controller.x).toBe(x);
  controller.up("KeyJ");
  controller.step(100);
  controller.step(10);
  expect(controller.action).toBe("walk");
  expect(controller.x).toBeGreaterThan(x);
  controller.downKey("KeyJ");
  controller.step(10);
  expect(controller.action).toBe("walk");
  controller.step(300);
  controller.downKey("KeyJ");
  controller.step(10);
  expect(controller.action).toBe("fireball");
});

it("releases held custom actions and toggles saved player-two actions off", () => {
  const controller = setup();
  controller.downKey("KeyK");
  controller.step(1000);
  expect(controller.action).toBe("shield");
  controller.up("KeyK");
  controller.step(10);
  expect(controller.action).toBe("idle");
  controller.downKey("Numpad1");
  controller.up("Numpad1");
  controller.step(1000);
  expect(controller.action).toBe("aura");
  controller.downKey("Numpad1");
  controller.step(10);
  expect(controller.action).toBe("idle");
});

it("allows unbound moves through buttons and applies facing-aware root motion once", () => {
  const controller = setup();
  controller.downKey("KeyA");
  controller.step(10);
  controller.up("KeyA");
  const x = controller.x;
  controller.downAction("dash", "button:dash");
  controller.step(100);
  controller.downKey("KeyK"); // The dash cannot be interrupted.
  controller.step(100);
  expect(controller.action).toBe("dash");
  expect(controller.x).toBeCloseTo(x - 80);
  controller.step(10);
  expect(controller.action).toBe("idle");
  expect(controller.x).toBeCloseTo(x - 80);
});

it("keeps cleared jump bindings clear and resets held and toggle actions on blur", () => {
  const controller = setup();
  controller.downKey("Space");
  controller.step(10);
  expect(controller.y).toBe(WORLD_GROUND);
  controller.downKey("Numpad1");
  controller.downKey("KeyD");
  controller.step(10);
  controller.reset();
  const x = controller.x;
  controller.step(10);
  expect(controller.action).toBe("idle");
  expect(controller.x).toBe(x);
});

it("moves preset characters briskly across the village and stops when movement is released", () => {
  const controller = setup();
  controller.manifest.actions.walk.gameplay.moveSpeed = 100;
  const start = controller.x;
  controller.downKey("KeyD");
  for (let frame = 0; frame < 60; frame++) controller.step(1000 / 60);
  expect(controller.x - start).toBeGreaterThan(180);
  controller.up("KeyD");
  const stopped = controller.x;
  controller.step(100);
  expect(controller.x).toBe(stopped);
});

it("lets preset characters clear a higher jump and land without allowing an extra midair jump", () => {
  const controller = setup();
  controller.manifest.actions.jump.gameplay.jumpVelocity = -280;
  controller.downAction("jump", "button:jump");
  let highest = WORLD_GROUND;
  for (let frame = 0; frame < 72; frame++) {
    controller.step(1000 / 60);
    highest = Math.min(highest, controller.y);
    if (frame === 20) controller.downAction("jump", "button:jump");
  }
  expect(WORLD_GROUND - highest).toBeGreaterThan(160);
  expect(controller.y).toBe(WORLD_GROUND);
  expect(controller.action).toBe("idle");
});

it("keeps the larger hero inside the map during powerful, low-gravity jumps", () => {
  const controller = setup();
  controller.manifest.actions.jump.gameplay.jumpVelocity = -700;
  controller.manifest.actions.jump.gameplay.gravityScale = 0.3;
  controller.downAction("jump", "button:jump");
  let highest = WORLD_GROUND;
  for (let frame = 0; frame < 240; frame++) {
    controller.step(1000 / 60);
    highest = Math.min(highest, controller.y);
  }
  expect(highest).toBeGreaterThanOrEqual(HERO_HEIGHT);
  expect(WORLD_GROUND - highest).toBeGreaterThan(460);
  expect(controller.y).toBe(WORLD_GROUND);
});

function advance(controller: WorldController, ms: number) {
  for (let remaining = ms; remaining > 0; remaining -= 1000 / 60) controller.step(Math.min(1000 / 60, remaining));
}

it("jumps through the mushroom ledge, lands on it, then jumps again onto the chicken ledge", () => {
  const controller = setup();
  controller.manifest.actions.jump.gameplay.jumpVelocity = -280;
  controller.x = 1450;
  controller.y = 767;
  expect(controller.grounded).toBe(true);
  controller.downAction("jump", "button:jump");
  advance(controller, 900);
  expect(controller.y).toBe(636);
  expect(controller.grounded).toBe(true);
  expect(controller.action).toBe("idle");
  controller.downAction("jump", "button:jump");
  advance(controller, 900);
  expect(controller.y).toBe(485);
  expect(controller.grounded).toBe(true);
  // Grounded actions must work on raised platforms too.
  controller.manifest.actions.crouch = { ...controller.manifest.actions.idle, gameplay: { ...controller.manifest.actions.idle.gameplay, trigger: "hold" } };
  controller.downAction("crouch", "button:crouch");
  controller.step(16);
  expect(controller.action).toBe("crouch");
});

it("falls when walking off a ledge and cannot start a jump in midair", () => {
  const controller = setup();
  controller.x = 900;
  controller.y = 431;
  controller.downKey("KeyD");
  advance(controller, 120);
  controller.up("KeyD");
  expect(controller.y).toBeGreaterThan(431);
  expect(controller.grounded).toBe(false);
  expect(controller.action).toBe("jump");
  const reference = setup();
  reference.x = 900;
  reference.y = 431;
  reference.downKey("KeyD");
  advance(reference, 120);
  reference.up("KeyD");
  controller.downAction("jump", "button:jump");
  advance(controller, 700);
  advance(reference, 700);
  expect(controller.y).toBe(reference.y);
  expect(controller.y).toBe(WORLD_GROUND);
  expect(controller.action).toBe("idle");
});

it("reaches the upper map using the saved preset jump and the stacked crates", () => {
  const controller = setup();
  controller.manifest.actions.walk.gameplay.moveSpeed = 100;
  controller.manifest.actions.jump.gameplay.jumpVelocity = -280;
  controller.x = 1480;
  controller.y = 767;
  for (const top of [636, 485, 397, 245]) {
    controller.downAction("jump", "button:jump");
    advance(controller, 1000);
    expect(controller.y).toBe(top);
    expect(controller.grounded).toBe(true);
  }
});

it("walks the log bridge in both directions without an invisible flat floor", () => {
  const controller = setup();
  controller.x = 1140;
  controller.downKey("KeyD");
  let lowest = controller.y;
  for (let frame = 0; frame < 55; frame++) { controller.step(1000 / 60); lowest = Math.max(lowest, controller.y); }
  expect(lowest).toBeGreaterThan(760);
  expect(controller.y).toBe(767);
  expect(controller.grounded).toBe(true);
  controller.up("KeyD");
  controller.downKey("KeyA");
  advance(controller, 1000);
  expect(controller.y).toBe(WORLD_GROUND);
  expect(controller.grounded).toBe(true);
});

it("respawns after touching spikes or falling out of the map and releases held controls", () => {
  for (const position of [{ x: 1140, y: 548 }, { x: 1300, y: VILLAGE_MAP.height + HERO_HEIGHT + 1 }]) {
    const controller = setup();
    Object.assign(controller, position);
    controller.downKey("KeyD");
    controller.step(16);
    expect(controller.x).toBe(VILLAGE_MAP.spawn.x);
    expect(controller.y).toBe(VILLAGE_MAP.spawn.y);
    expect(controller.action).toBe("idle");
    advance(controller, 100);
    expect(controller.x).toBe(VILLAGE_MAP.spawn.x);
  }
});

const collisionMap: WorldMap = {
  width: 1200, height: 1200, spawn: { x: 100, y: 900 }, hazards: [],
  platforms: [
    { id: "floor", left: 0, right: 1200, top: 900, bottom: 1200 },
    { id: "block", left: 300, right: 450, top: 600, bottom: 700 },
    { id: "ledge", left: 600, right: 800, top: 500 },
  ],
};

it("sweeps against solid sides and ceilings while letting a hero rise through one-way ledges", () => {
  expect(moveBody(collisionMap, 200, 800, 500, 0, false).x).toBe(300 - HERO_HALF_WIDTH);
  expect(moveBody(collisionMap, 550, 800, -500, 0, false).x).toBe(450 + HERO_HALF_WIDTH);
  const ceiling = moveBody(collisionMap, 350, 950, 0, -100, false);
  expect(ceiling.y).toBe(700 + HERO_HEIGHT);
  expect(ceiling.hitCeiling).toBe(true);
  const rising = moveBody(collisionMap, 700, 650, 0, -180, false);
  expect(rising.y).toBe(470);
  expect(rising.grounded).toBe(false);
  const landing = moveBody(collisionMap, 700, 450, 0, 600, false);
  expect(landing.y).toBe(500);
  expect(landing.grounded).toBe(true);
});

it("keeps action root motion inside solid walls and on the floor", () => {
  const controller = new WorldController(setup().manifest, undefined, collisionMap);
  controller.manifest.actions.dash.gameplay.rootMotion = { dx: 900, dy: 300, overMs: 200 };
  controller.downAction("dash", "button:dash");
  controller.step(200);
  expect(controller.x).toBe(300 - HERO_HALF_WIDTH);
  expect(controller.y).toBe(900);
});

it("lands reliably during long render frames and produces the same jump at different frame rates", () => {
  const controllers = [setup(), setup()];
  for (const controller of controllers) {
    controller.x = 1450;
    controller.y = 767;
    controller.manifest.actions.jump.gameplay.jumpVelocity = -280;
    controller.downAction("jump", "button:jump");
  }
  advance(controllers[0], 500);
  controllers[1].step(500);
  expect(controllers[0].y).toBeCloseTo(controllers[1].y, 6);
  controllers[0].step(1000);
  controllers[1].step(1000);
  for (const controller of controllers) {
    expect(controller.y).toBe(636);
    expect(controller.grounded).toBe(true);
  }
});

function atLadder() {
  const controller = setup();
  controller.x = 1260;
  controller.y = 485;
  return controller;
}

it("climbs the pink ladder, pauses without falling, and steps onto the house ledge", () => {
  const controller = atLadder();
  expect(controller.handlesKey("KeyW")).toBe(true);
  controller.downKey("KeyW");
  advance(controller, 500);
  expect(controller.climbing).toBe(true);
  expect(controller.grounded).toBe(false);
  expect(controller.x).toBe(1281);
  expect(controller.y).toBeCloseTo(395);
  expect(controller.action).toBe("walk");
  controller.up("KeyW");
  advance(controller, 500);
  expect(controller.y).toBeCloseTo(395);
  expect(controller.action).toBe("idle");
  controller.downKey("ArrowUp");
  advance(controller, 1000);
  expect(controller.y).toBe(272);
  expect(controller.climbing).toBe(false);
  expect(controller.grounded).toBe(true);
  expect(controller.action).toBe("idle");
  controller.up("ArrowUp");
  controller.downKey("ArrowDown");
  advance(controller, 1500);
  expect(controller.y).toBe(485);
  expect(controller.climbing).toBe(false);
  expect(controller.grounded).toBe(true);
});

it("uses saved jump and crouch keys away from ladders and climb controls when in reach", () => {
  const manifest = setup().manifest;
  manifest.actions.crouch = { ...manifest.actions.idle };
  const bindings = { p1: { jump: ["KeyW"], crouch: ["KeyS"] }, p2: { jump: ["ArrowUp"] } };
  const controller = new WorldController(manifest, bindings);
  controller.downKey("KeyS");
  controller.step(16);
  expect(controller.action).toBe("crouch");
  controller.up("KeyS");
  controller.downKey("KeyW");
  controller.step(16);
  expect(controller.action).toBe("jump");
  expect(controller.climbing).toBe(false);
  expect(controller.y).toBeLessThan(WORLD_GROUND);
  const nearby = new WorldController(manifest, bindings);
  nearby.x = 1281;
  nearby.y = 485;
  nearby.downKey("KeyW");
  nearby.step(100);
  expect(nearby.climbing).toBe(true);
  expect(nearby.y).toBeCloseTo(467);
  expect(nearby.action).toBe("walk");
});

it("lets a character walk away from a ladder and fall onto the ledge below", () => {
  const controller = atLadder();
  controller.downKey("KeyW");
  advance(controller, 500);
  const y = controller.y;
  controller.downKey("KeyD");
  controller.step(100);
  controller.up("KeyD");
  controller.up("KeyW");
  expect(controller.climbing).toBe(false);
  expect(controller.x).toBeGreaterThan(1281);
  expect(controller.y).toBeGreaterThan(y);
  advance(controller, 600);
  expect(controller.y).toBe(485);
  expect(controller.grounded).toBe(true);
});

it("jumps away from a ladder without immediately reattaching to a held climb key", () => {
  const controller = atLadder();
  controller.downKey("KeyW");
  advance(controller, 500);
  controller.downAction("jump", "button:jump");
  const start = controller.y;
  advance(controller, 100);
  expect(controller.climbing).toBe(false);
  expect(controller.y).toBeLessThan(start - 30);
  expect(controller.action).toBe("jump");
  controller.up("KeyW");
  controller.downKey("ArrowDown");
  expect(controller.climbing).toBe(true);
});

it("requires a reachable ladder, supports held buttons and clears climb input on blur", () => {
  const controller = setup();
  controller.x = 1281;
  expect(controller.climb("up", "button:up")).toBe(false);
  advance(controller, 200);
  expect(controller.climbing).toBe(false);
  controller.up("button:up");
  controller.x = 1281;
  controller.y = 485;
  expect(controller.climb("up", "button:up")).toBe(true);
  advance(controller, 400);
  controller.reset();
  const y = controller.y;
  advance(controller, 500);
  expect(controller.y).toBe(y);
  expect(controller.climbing).toBe(true);
  controller.climb("down", "button:down");
  advance(controller, 1000);
  expect(controller.y).toBe(485);
  expect(controller.grounded).toBe(true);
});

it("cancels opposite climb inputs and respects movement locks before attaching", () => {
  const controller = atLadder();
  controller.downAction("fireball", "button:fireball");
  controller.downKey("KeyW");
  controller.step(100);
  expect(controller.climbing).toBe(false);
  expect(controller.y).toBe(485);
  advance(controller, 300);
  expect(controller.climbing).toBe(true);
  controller.downKey("ArrowDown");
  const y = controller.y;
  advance(controller, 200);
  expect(controller.y).toBe(y);
  controller.up("ArrowDown");
  advance(controller, 200);
  expect(controller.y).toBeLessThan(y);
});

it("breaks treasure with a generated attack and retains collected loot through respawns", () => {
  const controller = setup();
  const hero = new WorldController(controller.manifest);
  hero.x = 460;
  hero.y = 338;
  hero.direction = "left";
  hero.downAction("fireball", "button:fireball");
  hero.step(100); // A long render frame must still process the impact window.
  expect(hero.items.destroyedChests.has("left-treasure")).toBe(true);
  expect(hero.items.coinCount).toBe(0);
  hero.x = 370;
  hero.step(16);
  expect(hero.items.coinCount).toBe(10);
  hero.reset();
  hero.x = 1140;
  hero.y = 548;
  hero.step(16); // Respawn retains already collected coins and broken chests.
  expect(hero.x).toBe(VILLAGE_MAP.spawn.x);
  expect(hero.items.coinCount).toBe(10);
  expect(hero.items.destroyedChests.has("left-treasure")).toBe(true);
});

it("uses saved offensive moves for chest damage and keeps F bindings intact", () => {
  const controller = setup();
  controller.x = 460;
  controller.y = 338;
  controller.direction = "left";
  controller.downKey("KeyJ"); // Saved Fireball attack.
  controller.step(100);
  expect(controller.action).toBe("fireball");
  expect(controller.items.destroyedChests.has("left-treasure")).toBe(true);
  const bound = new WorldController(setup().manifest, { p1: { shield: ["KeyF"] }, p2: {} });
  bound.downKey("KeyF");
  bound.step(100);
  expect(bound.action).toBe("shield");
  expect(bound.items.attackProgress).toBe(null);
});

it("does not attack with an unbound F key", () => {
  const controller = setup();
  expect(controller.handlesKey("KeyF")).toBe(false);
  controller.downKey("KeyF");
  controller.step(100);
  expect(controller.items.attackProgress).toBe(null);
  expect(controller.action).toBe("idle");
});

it("keeps the saved hold and toggle behavior for generated attack buttons", () => {
  for (const trigger of ["hold", "toggle"] as const) {
    const manifest = setup().manifest;
    manifest.actions.attack = { ...manifest.actions.fireball, gameplay: { trigger, lockMovement: true, interruptible: true } };
    const controller = new WorldController(manifest);
    controller.downAction("attack", "button:attack");
    controller.step(100);
    expect(controller.action).toBe("attack");
    if (trigger === "hold") controller.up("button:attack");
    else controller.downAction("attack", "button:attack");
    controller.step(16);
    expect(controller.action).toBe("idle");
  }
});

it("summons the goblin only after all 25 coins and continues its walk after input resets", () => {
  const controller = setup();
  expect(controller.goblin.spawned).toBe(false);
  for (const coin of VILLAGE_MAP.coins!) {
    controller.x = coin.x;
    controller.y = Math.max(HERO_HEIGHT, coin.y + 10);
    controller.step(16);
  }
  expect(controller.items.coinCount).toBe(5);
  expect(controller.goblin.spawned).toBe(false);
  for (const chest of VILLAGE_MAP.chests!) {
    controller.x = chest.right + 30;
    controller.y = chest.id === "left-treasure" ? 338 : 245;
    controller.direction = "left";
    controller.downAction("fireball", "button:fireball");
    controller.step(100);
    expect(controller.items.destroyedChests.has(chest.id)).toBe(true);
    controller.x = (chest.left + chest.right) / 2;
    controller.step(16);
    advance(controller, 600);
  }
  expect(controller.items.coinCount).toBe(25);
  expect(controller.goblin.spawned).toBe(true);
  expect(controller.goblin.active).toBe(true);
  const x = controller.goblin.x;
  controller.reset();
  controller.step(100);
  expect(controller.goblin.x).toBeLessThan(x);
});

it("wins after three generated attacks hit the goblin and freezes controls after victory", () => {
  const controller = setup();
  controller.goblin.step(16, true);
  controller.goblin.x = 700;
  controller.goblin.y = WORLD_GROUND;
  controller.x = 600;
  controller.direction = "right";
  for (const health of [2, 1, 0]) {
    controller.downKey("KeyJ");
    controller.step(100);
    expect(controller.goblin.health).toBe(health);
    expect(controller.won).toBe(health === 0);
    controller.up("KeyJ");
    controller.step(450);
  }
  expect(controller.goblin.active).toBe(false);
  const x = controller.x, y = controller.y;
  controller.downKey("KeyD");
  controller.move("left", "button:left");
  controller.downAction("jump", "button:jump");
  controller.step(1000);
  expect(controller.x).toBe(x);
  expect(controller.y).toBe(y);
  expect(controller.action).toBe("idle");
  controller.reset();
  expect(controller.won).toBe(true);
});

function meetingGoblin(heroX = 400, goblinX = 700) {
  const controller = setup();
  controller.x = heroX;
  controller.y = WORLD_GROUND;
  controller.goblin.step(16, true);
  controller.goblin.x = goblinX;
  controller.goblin.y = WORLD_GROUND;
  return controller;
}

it("blocks the hero and goblin walking into each other without pushing or swapping sides", () => {
  const controller = meetingGoblin();
  controller.downKey("KeyD");
  advance(controller, 1500);
  const distance = HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH;
  expect(controller.goblin.x - controller.x).toBeCloseTo(distance);
  const heroX = controller.x, goblinX = controller.goblin.x;
  advance(controller, 600);
  expect(controller.x).toBeCloseTo(heroX);
  expect(controller.goblin.x).toBeCloseTo(goblinX);
  controller.up("KeyD");
  advance(controller, 500);
  expect(controller.x).toBeCloseTo(heroX);
  expect(controller.goblin.x).toBeCloseTo(goblinX);
  controller.downKey("KeyA");
  advance(controller, 300);
  expect(controller.x).toBeLessThan(heroX);
  expect(controller.goblin.x).toBeLessThan(goblinX);
});

it("blocks an overtaking hero on the goblin's right side", () => {
  const controller = meetingGoblin(1000);
  controller.downKey("KeyA");
  advance(controller, 1500);
  expect(controller.x - controller.goblin.x).toBeGreaterThanOrEqual(HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH - 0.001);
  expect(controller.goblin.x).toBeLessThan(700);
});

it("blocks the goblin's offscreen entrance if the hero waits at the right map boundary", () => {
  const controller = meetingGoblin(VILLAGE_MAP.width - HERO_HALF_WIDTH, VILLAGE_MAP.width + 180);
  controller.y = 767;
  controller.goblin.y = 767;
  advance(controller, 2500);
  expect(controller.x).toBe(VILLAGE_MAP.width - HERO_HALF_WIDTH);
  expect(controller.goblin.x - controller.x).toBeCloseTo(HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH);
});

it("sweeps fast movement and root-motion dashes against the goblin from either side", () => {
  for (const [x, direction] of [[400, "right"], [1000, "left"]] as const) {
    for (const dash of [false, true]) {
      const controller = meetingGoblin(x);
      controller.goblin.hurtTimeMs = 1000;
      controller.direction = direction;
      if (dash) {
        controller.manifest.actions.dash.gameplay.rootMotion = { dx: 1200, dy: 0, overMs: 200 };
        controller.downAction("dash", "button:dash");
      } else {
        controller.manifest.actions.walk.gameplay.moveSpeed = 50_000;
        controller.move(direction, "button:move");
      }
      controller.step(200);
      expect(controller.x).toBeCloseTo(700 + (direction === "left" ? 1 : -1) * (HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH));
    }
  }
});

it("lets the hero pass above the goblin on a platform or during a sufficiently high jump", () => {
  const raised = meetingGoblin(600);
  raised.y = 431;
  raised.downKey("KeyD");
  advance(raised, 400);
  expect(raised.x).toBeGreaterThan(raised.goblin.x + HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH);
  expect(raised.y).toBe(431);
  const jumping = meetingGoblin();
  jumping.downAction("jump", "button:jump");
  jumping.downKey("KeyD");
  advance(jumping, 800);
  expect(jumping.x).toBeGreaterThan(jumping.goblin.x + HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH);
  expect(jumping.y).toBeLessThan(jumping.goblin.body.top);
});

it("lands on the goblin's solid head and can jump again from that support", () => {
  const controller = meetingGoblin(1000, 1000);
  controller.goblin.hurtTimeMs = 2000;
  controller.y = 300;
  advance(controller, 600);
  expect(controller.y).toBe(controller.goblin.body.top);
  expect(controller.grounded).toBe(true);
  const head = controller.y;
  controller.downAction("jump", "button:jump");
  advance(controller, 100);
  expect(controller.y).toBeLessThan(head);
});

it("resolves a respawn overlap and creates no invisible blocker before the goblin spawns", () => {
  const overlapping = meetingGoblin(260, 260);
  overlapping.step(16);
  expect(Math.abs(overlapping.x - overlapping.goblin.x)).toBeGreaterThanOrEqual(HERO_HALF_WIDTH + GOBLIN_HALF_WIDTH - 0.001);
  const hidden = setup();
  hidden.goblin.x = 500;
  hidden.goblin.y = WORLD_GROUND;
  hidden.downKey("KeyD");
  advance(hidden, 1000);
  expect(hidden.x).toBeGreaterThan(hidden.goblin.x);
});
