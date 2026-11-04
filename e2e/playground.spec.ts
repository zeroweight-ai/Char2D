import { expect, test, type Page } from "@playwright/test";
import type { CharacterDetail } from "../src/lib/character";
import type { Manifest } from "../src/lib/manifest";
import { VILLAGE_MAP, WORLD_GROUND } from "../src/lib/game/world";

function character(id: string, name: string): CharacterDetail {
  const actions = Object.fromEntries(["idle", "walk", "jump", "crouch"].map(key => [key, {
    label: key, playback: key === "jump" ? "once" : "loop",
    directions: { right: { frames: [{ x: 0, y: 0, w: 32, h: 48, anchorX: 16, anchorY: 48, durationMs: 100 }] }, left: { mirrorOf: "right" } },
    gameplay: { trigger: key === "jump" ? "press" : "hold", lockMovement: false, interruptible: true, ...(key === "jump" ? { jumpVelocity: -280 } : {}) },
  }]));
  return { id, name, description: "Test adventurer", status: "ready", sourceAssetId: null, sheet: null, job: null,
    manifest: { version: 1, characterId: id, viewType: "side_scroller", atlas: { url: "/test-playground-atlas.svg", width: 32, height: 48, version: 1 }, pixelScale: 1, actions } as Manifest,
    bindings: { p1: { jump: ["KeyJ"], crouch: ["KeyS"] }, p2: { jump: ["ArrowUp"], crouch: ["ArrowDown"] } },
  };
}

async function mockCharacters(page: Page, characters: CharacterDetail[]) {
  await page.route("**/api/characters", route => route.fulfill({ json: characters }));
  await page.route("**/test-playground-atlas.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"><rect x="4" y="2" width="24" height="46" fill="#287932"/></svg>' }));
}

async function expectFeetOnSurface(page: Page) {
  const player = page.getByTestId("playground-player");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await expect.poll(() => player.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = canvas.height - 1; y >= 0; y--) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]) return Math.abs(y + 1 - Number(canvas.dataset.y));
    }
    return Infinity;
  })).toBeLessThanOrEqual(2);
}

test("asset requests compile and return a normal missing-asset response", async ({ request }) => {
  const response = await request.get("/api/assets/playground-build-check");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "Asset not found" });
});

test("choose a generated hero, enter the village, move, jump and change characters", async ({ page }, testInfo) => {
  await mockCharacters(page, [character("knight", "Green Knight"), character("mage", "Village Mage"), { ...character("draft", "Still drawing"), manifest: null, status: "generating" }]);
  await page.goto("/");
  await page.getByRole("link", { name: "Playground", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Explore / })).toHaveCount(0);
  await expect(page.locator(".world-map")).toHaveCount(0);
  const dialog = page.getByRole("dialog", { name: "Choose your character" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Start playing" })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Green Knight/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  await expect(dialog).not.toBeVisible();
  const map = page.getByRole("img", { name: /Pixel-art village/ });
  await expect(map).toHaveAttribute("src", /\/worlds\/village-platformer\.png$/);
  await expect.poll(() => map.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1672);
  await expect(map).toHaveCSS("filter", "brightness(0.86) saturate(0.84) contrast(0.96)");
  const player = page.getByTestId("playground-player");
  await expect(player).toHaveCSS("filter", "none");
  await expect(page.getByTestId("playground-items")).toHaveCSS("filter", "none");
  await expect(player).toHaveAttribute("aria-label", "Green Knight exploring Market Adventure");
  await expect.poll(() => player.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  const stage = page.getByRole("group", { name: "Village map, keyboard controls" });
  const roadY = Number(await player.getAttribute("data-y"));
  expect(roadY).toBe(WORLD_GROUND);
  await expectFeetOnSurface(page);
  await stage.focus();
  await page.keyboard.down("KeyD");
  await expect(player).toHaveAttribute("data-action", "walk");
  await expect.poll(async () => Number(await player.getAttribute("data-x"))).toBeGreaterThan(280);
  await page.keyboard.up("KeyD");
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.keyboard.press("KeyJ");
  await expect(player).toHaveAttribute("data-action", "jump");
  await expect.poll(async () => Number(await player.getAttribute("data-y"))).toBeLessThan(roadY - 100);
  await expect(player).toHaveAttribute("data-action", "idle");
  await expect(player).toHaveAttribute("data-y", String(roadY));
  // Pointer controls should work immediately while the map has keyboard focus.
  const left = page.getByRole("button", { name: "Move left" });
  await left.hover();
  await page.mouse.down();
  await expect(player).toHaveAttribute("data-action", "walk");
  await expect(player).toHaveAttribute("data-direction", "left");
  await page.mouse.up();
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.screenshot({ path: testInfo.outputPath("village.png"), fullPage: true });
  await page.getByRole("button", { name: "Change character" }).click();
  await expect(dialog.getByRole("radio", { name: /Green Knight/ })).toBeChecked();
  await dialog.getByRole("radio", { name: /Village Mage/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  await expect(player).toHaveAttribute("aria-label", "Village Mage exploring Market Adventure");
  await page.getByRole("button", { name: "Change character" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(player).toHaveAttribute("aria-label", "Village Mage exploring Market Adventure");
  await expect(page.getByRole("button", { name: "Back to world map" })).toHaveCount(0);
});

test("draws the feet on the road and bridge collision surfaces", async ({ page }, testInfo) => {
  const hero = character("bridge", "Bridge Explorer");
  hero.manifest!.actions.walk.gameplay.moveSpeed = 400;
  await mockCharacters(page, [hero]);
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Bridge Explorer/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  const player = page.getByTestId("playground-player");
  await expectFeetOnSurface(page);
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [10] }).toBeGreaterThan(1260);
  await page.keyboard.up("KeyD");
  await expectFeetOnSurface(page);
  const x = Number(await player.getAttribute("data-x")), y = Number(await player.getAttribute("data-y"));
  expect(VILLAGE_MAP.platforms.some(platform => platform.id.startsWith("bridge-") && platform.top === y && x + 26 > platform.left && x - 26 < platform.right)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("bridge-foot-contact.png"), fullPage: true });
  await page.keyboard.down("KeyA");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [10] }).toBeLessThan(1000);
  await page.keyboard.up("KeyA");
  await expect(player).toHaveAttribute("data-y", String(WORLD_GROUND));
  await expectFeetOnSurface(page);
});

test("empty party and cancelled selection allow reopening the character picker on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCharacters(page, []);
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "No playable characters yet" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Create a character" })).toHaveAttribute("href", "/create");
  await expect(dialog.getByRole("button", { name: "Start playing" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Choose character", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Choose character", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("playground-player")).toHaveCount(0);
  await expect(page.locator(".world-map")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("lands on higher village platforms, jumps again from a ledge and falls onto the platform below", async ({ page }, testInfo) => {
  const hero = character("climber", "Platform Climber");
  hero.manifest!.actions.walk.gameplay.moveSpeed = 100;
  await mockCharacters(page, [hero]);
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Platform Climber/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  const player = page.getByTestId("playground-player");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { timeout: 10_000, intervals: [20] }).toBeGreaterThan(1460);
  await page.keyboard.up("KeyD");
  await expect(player).toHaveAttribute("data-y", "767");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await expectFeetOnSurface(page);
  for (const platformY of [636, 485]) {
    await page.keyboard.press("KeyJ");
    await expect(player).toHaveAttribute("data-grounded", "false");
    await expect(player).toHaveAttribute("data-y", String(platformY));
    await expect(player).toHaveAttribute("data-grounded", "true");
    await expect(player).toHaveAttribute("data-action", "idle");
    await expectFeetOnSurface(page);
  }
  await page.screenshot({ path: testInfo.outputPath("platform-landing.png"), fullPage: true });
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeGreaterThan(1620);
  await page.keyboard.up("KeyD");
  await expect(player).toHaveAttribute("data-y", "636");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.keyboard.down("KeyA");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeLessThan(1490);
  await page.keyboard.up("KeyA");
  await page.keyboard.press("KeyJ");
  await expect(player).toHaveAttribute("data-y", "485");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.keyboard.down("KeyA");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeLessThan(1290);
  await page.keyboard.up("KeyA");
  await page.keyboard.down("KeyW");
  await expect(player).toHaveAttribute("data-y", "272");
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeGreaterThan(1420);
  await page.keyboard.press("KeyJ");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeGreaterThan(1490);
  await page.keyboard.up("KeyD");
  await expect(player).toHaveAttribute("data-y", "245");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.screenshot({ path: testInfo.outputPath("upper-map-landing.png"), fullPage: true });
});

test("climbs the pink ladder onto the upper ledge with keyboard and held button controls", async ({ page }, testInfo) => {
  const hero = character("ladder", "Ladder Explorer");
  hero.manifest!.actions.walk.gameplay.moveSpeed = 100;
  await mockCharacters(page, [hero]);
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Ladder Explorer/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  const player = page.getByTestId("playground-player");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { timeout: 10_000, intervals: [20] }).toBeGreaterThan(1460);
  await page.keyboard.up("KeyD");
  for (const platformY of [636, 485]) {
    await page.keyboard.press("KeyJ");
    await expect(player).toHaveAttribute("data-y", String(platformY));
    await expect(player).toHaveAttribute("data-grounded", "true");
  }
  await page.keyboard.down("KeyA");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeLessThan(1290);
  await page.keyboard.up("KeyA");
  // W is deliberately unbound in this fixture; ladder controls still work.
  await page.keyboard.down("KeyW");
  await expect(player).toHaveAttribute("data-climbing", "true");
  await expect(player).toHaveAttribute("data-x", "1281");
  await expect.poll(async () => Number(await player.getAttribute("data-y")), { intervals: [20] }).toBeLessThan(440);
  await page.keyboard.up("KeyW");
  await expect(player).toHaveAttribute("data-action", "idle");
  const pausedY = await player.getAttribute("data-y");
  await page.waitForTimeout(200);
  await expect(player).toHaveAttribute("data-y", pausedY!);
  await expect(player).toHaveAttribute("data-climbing", "true");
  await page.screenshot({ path: testInfo.outputPath("pink-ladder-climb.png"), fullPage: true });
  await page.keyboard.down("ArrowUp");
  await expect(player).toHaveAttribute("data-y", "272");
  await expect(player).toHaveAttribute("data-climbing", "false");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.keyboard.up("ArrowUp");

  const down = page.getByRole("button", { name: "Climb down", exact: true });
  await down.hover();
  await page.mouse.down();
  await expect(player).toHaveAttribute("data-climbing", "true");
  await expect(player).toHaveAttribute("data-y", "485");
  await page.mouse.up();
  await expect(player).toHaveAttribute("data-grounded", "true");
  const up = page.getByRole("button", { name: "Climb up", exact: true });
  await up.focus();
  await page.keyboard.down("Space");
  await expect(player).toHaveAttribute("data-climbing", "true");
  await expect(player).toHaveAttribute("data-y", "272");
  await page.keyboard.up("Space");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.getByRole("group", { name: "Village map, keyboard controls" }).focus();
  await page.keyboard.down("KeyA");
  await expect.poll(async () => Number(await player.getAttribute("data-x")), { intervals: [20] }).toBeLessThan(1250);
  await page.keyboard.up("KeyA");
  await expect(player).toHaveAttribute("data-y", "272");
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("collects the map coins and attacks both treasure chests for their loot", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const hero = character("treasure", "Treasure Hunter");
  hero.manifest!.actions.walk.gameplay.moveSpeed = 400;
  hero.manifest!.actions.attack = { ...hero.manifest!.actions.idle, label: "Attack", gameplay: { trigger: "press", lockMovement: false, interruptible: true } };
  hero.bindings!.p1.attack = ["KeyK"];
  await mockCharacters(page, [hero]);
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Treasure Hunter/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  const player = page.getByTestId("playground-player");
  const items = page.getByTestId("playground-items");
  const stage = page.getByRole("group", { name: "Village map, keyboard controls" });
  const coins = page.getByRole("status", { name: "Coins collected" });
  const goblin = page.getByTestId("playground-goblin");
  await expect(coins).toHaveText(/Coins 0/);
  await expect(items).toHaveAttribute("data-remaining-coins", "10");
  await expect(goblin).toHaveAttribute("data-spawned", "false");
  await expect(page.getByRole("group", { name: "Movement controls" }).getByRole("button", { name: "Attack", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Character actions" }).getByRole("button", { name: "Attack", exact: true })).toHaveCount(1);
  await page.keyboard.press("KeyF");
  await expect(player).toHaveAttribute("data-attacking", "false");
  await page.keyboard.press("KeyK");
  await expect(player).toHaveAttribute("data-attacking", "true");
  await expect(player).toHaveAttribute("data-chests-destroyed", "0");

  async function walkTo(target: number) {
    const start = Number(await player.getAttribute("data-x"));
    const code = target > start ? "KeyD" : "KeyA";
    await stage.focus();
    await page.keyboard.down(code);
    await expect.poll(async () => {
      const x = Number(await player.getAttribute("data-x"));
      return target > start ? x >= target : x <= target;
    }, { intervals: [10] }).toBe(true);
    await page.keyboard.up(code);
  }
  async function jumpTo(y: number) {
    await page.keyboard.press("KeyJ");
    await expect(player).toHaveAttribute("data-grounded", "false");
    await expect(player).toHaveAttribute("data-y", String(y));
    await expect(player).toHaveAttribute("data-grounded", "true");
  }
  await walkTo(1460);
  await expect(player).toHaveAttribute("data-y", "767");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await jumpTo(636);
  await jumpTo(485);
  await walkTo(1285);
  await page.keyboard.down("KeyW");
  await expect(player).toHaveAttribute("data-y", "272");
  await page.keyboard.up("KeyW");
  await walkTo(1420);
  await page.keyboard.press("KeyJ");
  await walkTo(1510);
  await expect(player).toHaveAttribute("data-y", "245");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect(items).toHaveAttribute("data-destroyed-chests", "right-treasure");
  await walkTo(1470);
  await walkTo(1580);
  await expect(coins).toHaveText(/Coins 15/);
  await walkTo(1400);
  await page.screenshot({ path: testInfo.outputPath("right-chest-destroyed.png"), fullPage: true });

  await walkTo(590);
  await expect(player).toHaveAttribute("data-y", "431");
  await expect(coins).toHaveText(/Coins 20/);
  await expect(goblin).toHaveAttribute("data-spawned", "false");
  await expect(items).toHaveAttribute("data-remaining-coins", "0");
  await page.keyboard.press("KeyJ");
  await walkTo(460);
  await expect(player).toHaveAttribute("data-y", "338");
  await expect(player).toHaveAttribute("data-grounded", "true");
  await page.keyboard.press("KeyK");
  await expect(player).toHaveAttribute("data-chests-destroyed", "2");
  await walkTo(350);
  await walkTo(420);
  await expect(coins).toHaveText(/Coins 30/);
  await expect(goblin).toHaveAttribute("data-spawned", "true");
  await expect(goblin).toHaveAttribute("data-active", "true");
  await expect(goblin).toHaveAttribute("data-direction", "left");
  await expect(page.getByRole("status", { name: "World events" })).toContainText("All coins collected!");
  await expect(items).toHaveAttribute("data-remaining-coins", "0");
  await walkTo(500);
  await page.keyboard.press("KeyK");
  await expect(player).toHaveAttribute("data-attacking", "false");
  await expect(coins).toHaveText(/Coins 30/);
  await page.screenshot({ path: testInfo.outputPath("collected-coins-and-treasure.png"), fullPage: true });
  const startX = Number(await goblin.getAttribute("data-x"));
  await expect.poll(async () => Number(await goblin.getAttribute("data-x"))).toBeLessThan(startX - 100);
  await expect.poll(() => goblin.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  const firstFrame = await goblin.getAttribute("data-frame");
  await expect.poll(() => goblin.getAttribute("data-frame"), { intervals: [30] }).not.toBe(firstFrame);
  await expect.poll(async () => Number(await goblin.getAttribute("data-x"))).toBeLessThan(1550);
  await page.screenshot({ path: testInfo.outputPath("goblin-soldier-marching-left.png"), fullPage: true });
  await walkTo(1000); // Drop to the road before approaching the spike ledge.
  await expect(player).toHaveAttribute("data-y", String(WORLD_GROUND));
  await expect(player).toHaveAttribute("data-grounded", "true");
  const heroOnLeft = Number(await player.getAttribute("data-x")) < Number(await goblin.getAttribute("data-x"));
  const approach = heroOnLeft ? "KeyD" : "KeyA";
  await page.keyboard.down(approach);
  await expect.poll(async () => Math.abs(Number(await goblin.getAttribute("data-x")) - Number(await player.getAttribute("data-x"))), { intervals: [20] }).toBeLessThanOrEqual(75);
  await page.waitForTimeout(100); // Let the final partial-pixel movement settle at contact.
  const contactX = await player.getAttribute("data-x"), goblinContactX = await goblin.getAttribute("data-x");
  await page.waitForTimeout(400); // Holding forward must not walk through the enemy.
  if (heroOnLeft) {
    await expect(player).toHaveAttribute("data-x", contactX!);
    await expect(goblin).toHaveAttribute("data-x", goblinContactX!);
  }
  const signedGap = Number(await goblin.getAttribute("data-x")) - Number(await player.getAttribute("data-x"));
  expect(signedGap * (heroOnLeft ? 1 : -1)).toBeGreaterThanOrEqual(73);
  await page.keyboard.up(approach);
  const victory = page.getByRole("dialog", { name: "You Win!" });
  for (const health of [2, 1, 0]) {
    const facing = Number(await goblin.getAttribute("data-x")) >= Number(await player.getAttribute("data-x")) ? "right" : "left";
    const code = facing === "right" ? "KeyD" : "KeyA";
    await page.keyboard.down(code);
    await expect(player).toHaveAttribute("data-direction", facing);
    await page.keyboard.up(code);
    await page.keyboard.press("KeyK");
    await expect(goblin).toHaveAttribute("data-health", String(health));
    if (health) {
      await expect(victory).not.toBeVisible();
      await page.waitForTimeout(420); // Separate attacks must respect the saved combat cooldown.
    }
  }
  await expect(victory).toBeVisible();
  await expect(goblin).toHaveAttribute("data-active", "false");
  await expect(goblin).toHaveAttribute("data-defeated", "true");
  await expect(player).toHaveAttribute("data-won", "true");
  await expect.poll(() => goblin.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("you-win.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const next = victory.getByRole("button", { name: "Play again" });
  await expect(next).toBeFocused();
  await next.click();
  await expect(victory).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Market Adventure", exact: true })).toBeVisible();
  await expect(player).toHaveAttribute("aria-label", "Treasure Hunter exploring Market Adventure");
  await expect(player).toHaveAttribute("data-coins", "0");
  await expect(player).toHaveAttribute("data-won", "false");
  await expect(goblin).toHaveAttribute("data-spawned", "false");
  await expect(goblin).toHaveAttribute("data-health", "3");
  await expect(items).toHaveAttribute("data-remaining-coins", "10");
  await page.keyboard.down("KeyD");
  await expect(player).toHaveAttribute("data-action", "walk");
  await page.keyboard.up("KeyD");
});

test("custom moves use saved keys and button controls with press, hold and toggle behavior", async ({ page }, testInfo) => {
  const hero = character("custom", "Custom Hero");
  const base = hero.manifest!.actions.idle;
  for (const [key, label, trigger] of [["fireball", "Fireball", "press"], ["shield", "Magic shield", "hold"], ["aura", "Power aura", "toggle"], ["wave", "Wave hello", "press"]] as const) {
    hero.manifest!.actions[key] = { ...base, label, directions: { right: { frames: [{ ...base.directions.right!.frames![0], durationMs: 450 }] }, left: { mirrorOf: "right" } }, gameplay: { ...base.gameplay, trigger } };
  }
  hero.bindings!.p1.fireball = ["KeyK"];
  hero.bindings!.p1.shield = ["KeyL"];
  hero.bindings!.p2.aura = ["Numpad1"];
  await mockCharacters(page, [hero]);
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Custom Hero/ }).check();
  await dialog.getByRole("button", { name: "Start playing" }).click();
  const player = page.getByTestId("playground-player");
  const actions = page.getByRole("group", { name: "Character actions" });
  for (const label of ["Fireball", "Magic shield", "Power aura", "Wave hello"]) await expect(actions.getByRole("button", { name: label, exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Fireball", exact: true })).toContainText("K");
  // Measure actual opaque pixels so the larger sprite is verified visually.
  await expect.poll(() => player.evaluate(element => {
    const canvas = element as HTMLCanvasElement, pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = canvas.height, last = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3]) { first = Math.min(first, y); last = Math.max(last, y); }
    return last - first + 1;
  })).toBeGreaterThan(220);
  await page.keyboard.press("KeyK");
  await expect(player).toHaveAttribute("data-action", "fireball");
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.keyboard.down("KeyL");
  await expect(player).toHaveAttribute("data-action", "shield");
  await page.keyboard.up("KeyL");
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.keyboard.press("Numpad1");
  await expect(player).toHaveAttribute("data-action", "aura");
  await expect(actions.getByRole("button", { name: "Power aura", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Numpad1");
  await expect(player).toHaveAttribute("data-action", "idle");
  // An unbound move remains available through its button.
  await actions.getByRole("button", { name: "Wave hello", exact: true }).click();
  await expect(player).toHaveAttribute("data-action", "wave");
  await expect(player).toHaveAttribute("data-action", "idle");
  await actions.getByRole("button", { name: "Magic shield", exact: true }).hover();
  await page.mouse.down();
  await expect(player).toHaveAttribute("data-action", "shield");
  await page.mouse.up();
  await expect(player).toHaveAttribute("data-action", "idle");
  await actions.getByRole("button", { name: "Power aura", exact: true }).click();
  await expect(player).toHaveAttribute("data-action", "aura");
  await actions.getByRole("button", { name: "Power aura", exact: true }).click();
  await expect(player).toHaveAttribute("data-action", "idle");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("custom-actions-mobile.png"), fullPage: true });
});

test("character loading failures can be retried", async ({ page }) => {
  let fail = true;
  await page.route("**/api/characters", route => fail ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fulfill({ json: [character("knight", "Green Knight")] }));
  await page.goto("/playground");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Could not load your characters.", { timeout: 15_000 });
  await expect(dialog.getByRole("button", { name: "Start playing" })).toBeDisabled();
  fail = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("radio", { name: /Green Knight/ })).toBeVisible();
});
