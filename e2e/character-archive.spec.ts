import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import type { Manifest } from "../src/lib/manifest";

test("exports all frames as a ZIP and restores a playable copy through Create Character", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const name = `ZIP Knight ${Date.now()}`, restoredName = `${name} restored`;
  await page.goto("/create");
  await page.getByRole("radio", { name: /Describe a character/ }).check();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await page.getByLabel("Describe your character").fill("A green knight with silver armor");
  await page.getByRole("button", { name: "Generate character sheet" }).click();
  await page.getByRole("button", { name: "Looks good — accept sheet" }).click({ timeout: 30_000 });
  await expect(page.getByTestId("hero-status")).toHaveText("Ready to play", { timeout: 30_000 });
  const originalEndpoint = new URL(page.url()).pathname.replace("/characters/", "/api/characters/");
  const original = await (await request.get(originalEndpoint)).json();
  const manifest = original.manifest as Manifest;

  await page.getByText("Export ▾", { exact: true }).click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "All frames (ZIP)", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/-frames\.zip$/);
  const bytes = await readFile((await download.path())!);
  const files = unzipSync(bytes);
  const expectedFrames = Object.values(manifest.actions).reduce((total, action) => total + Object.values(action.directions).reduce((sum, direction) => sum + (direction.frames ?? (direction.mirrorOf ? action.directions[direction.mirrorOf]?.frames : []))!.length, 0), 0);
  expect(Object.keys(files).filter(path => path.startsWith("frames/"))).toHaveLength(expectedFrames);
  expect(files["character.json"]).toBeTruthy();
  expect(files["sheet.png"]).toBeTruthy();
  expect(files["manifest.json"]).toBeTruthy();

  await page.goto("/create");
  await page.getByRole("radio", { name: /Upload a ZIP/ }).check();
  await page.getByLabel("Character ZIP", { exact: true }).setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip", buffer: bytes });
  await page.getByLabel("Character name (optional)", { exact: true }).fill(restoredName);
  await expect(page.getByText("Restores your frames, moves and controls. No AI generation.", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("upload-character-zip.png"), fullPage: true });
  const importedResponse = page.waitForResponse(response => response.url().endsWith("/api/characters/import") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Import character", exact: true }).click();
  const importedResult = await importedResponse;
  expect(importedResult.status()).toBe(201);
  const result = await importedResult.json();
  expect(result.imageCalls).toBe(0);
  expect(result.id).not.toBe(original.id);
  await expect(page).toHaveURL(new RegExp(`/characters/${result.id}$`));
  await expect(page.getByTestId("hero-status")).toHaveText("Ready to play");
  await expect(page.getByRole("heading", { name: restoredName, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your transparent character sheet" })).toHaveCount(0);
  const restored = await (await request.get(`/api/characters/${result.id}`)).json();
  expect(restored.bindings).toEqual(original.bindings);
  expect(Object.keys(restored.manifest.actions)).toEqual(Object.keys(manifest.actions));
  expect(restored.animation.actions).toHaveLength(Object.keys(manifest.actions).length);
  expect(restored.animation.running).toBe(0);
  expect(restored.job).toBeNull();
  for (const [key, action] of Object.entries(manifest.actions)) {
    expect(restored.manifest.actions[key].gameplay).toEqual(action.gameplay);
    expect(restored.manifest.actions[key].playback).toBe(action.playback);
    expect(restored.manifest.actions[key].directions).toEqual(action.directions);
    if (action.sound) {
      expect(restored.manifest.actions[key].sound.frames).toEqual(action.sound.frames);
      expect(await (await request.get(restored.manifest.actions[key].sound.url)).body()).toEqual(await (await request.get(action.sound.url)).body());
    }
  }
  await page.getByRole("button", { name: "Walk", exact: true }).click();
  await expect(page.getByTestId("sprite-player")).toHaveAttribute("data-action", "walk");
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(page.getByRole("button", { name: "Regenerate Walk", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Controls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Controls", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Playground", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose your character" });
  await picker.getByRole("radio", { name: new RegExp(restoredName) }).check();
  await picker.getByRole("button", { name: "Start playing" }).click();
  const player = page.getByTestId("playground-player");
  await expect(player).toHaveAttribute("aria-label", `${restoredName} exploring Market Adventure`);
  await page.keyboard.down("KeyD");
  await expect(player).toHaveAttribute("data-action", "walk");
  await page.keyboard.up("KeyD");
  expect((await (await request.get(originalEndpoint)).json()).name).toBe(name);
});

test("rejects invalid ZIP uploads without creating a character, including on mobile", async ({ page, request }, testInfo) => {
  const before = await (await request.get("/api/characters")).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByRole("radio", { name: /Upload a ZIP/ }).check();
  await page.getByLabel("Character ZIP", { exact: true }).setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
  await page.getByRole("button", { name: "Import character", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not a supported ZIP" })).toBeVisible();
  await expect(page).toHaveURL(/\/create$/);
  expect((await (await request.get("/api/characters")).json()).length).toBe(before.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("invalid-zip-mobile.png"), fullPage: true });
  const missing = await request.get("/api/characters/missing-archive-character/export");
  expect(missing.status()).toBe(404);
});
