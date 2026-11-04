import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { eq } from "drizzle-orm";
import type { CharacterArchive } from "../src/lib/character-archive";
const state = vi.hoisted(() => ({ config: { dataDir: "", fakeAI: false, apiKey: "", elevenLabsKey: "" }, generate: vi.fn(), chat: vi.fn() }));
vi.mock("../src/server/config", () => ({ config: state.config }));
vi.mock("../src/server/ai", () => ({ provider: { generate: state.generate, chat: state.chat } }));
import { getDatabase, openDatabase } from "../src/server/db";
import { actionVersions, assets, characters, jobs } from "../src/server/db/schema";
import { importCharacterZip, exportCharacterZip } from "../src/server/characters/archive";
import { readCharacterZip } from "../src/server/characters/archive-zip";
import { getCharacter } from "../src/server/characters/repository";
import { readAsset } from "../src/server/storage/assets";
import { updateAction } from "../src/server/characters/edit";
import { deleteAction } from "../src/server/characters/delete";
import { JobQueue } from "../src/server/jobs/queue";
import { runAnimationJob } from "../src/server/pipeline/animations";

const globalDb = globalThis as typeof globalThis & { char2dDb?: ReturnType<typeof openDatabase> };
let previous: ReturnType<typeof openDatabase> | undefined;
let archive: CharacterArchive, entries: Record<string, Uint8Array>;

function zip(bundle = archive, files = entries) { return Buffer.from(zipSync({ ...files, "character.json": strToU8(JSON.stringify(bundle)) })); }
async function rgba(bytes: Uint8Array) { return sharp(bytes).ensureAlpha().raw().toBuffer(); }
async function atlas(id: string) { const character = getCharacter(id)!; return (await readAsset(character.manifest!.atlas.url.split("/").pop()!))!.bytes; }

beforeEach(async () => {
  previous = globalDb.char2dDb;
  state.config.dataDir = mkdtempSync(join(tmpdir(), "char2d-archive-"));
  globalDb.char2dDb = openDatabase(state.config.dataDir);
  state.generate.mockReset(); state.chat.mockReset();
  entries = Object.create(null);
  const pixels = Buffer.alloc(12 * 16 * 4);
  for (let y = 2; y < 15; y++) for (let x = 2; x < 10; x++) {
    const index = (y * 12 + x) * 4;
    pixels[index] = x * 20; pixels[index + 1] = y * 12; pixels[index + 2] = 80; pixels[index + 3] = 255;
  }
  const frame = await sharp(pixels, { raw: { width: 12, height: 16, channels: 4 } }).png().toBuffer();
  entries["sheet.png"] = await sharp({ create: { width: 36, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([0, 12, 24].map(left => ({ input: frame, left, top: 0 }))).png().toBuffer();
  entries["anchors/right.png"] = frame;
  const wav = Buffer.alloc(46);
  wav.write("RIFF"); wav.writeUInt32LE(38, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(2, 40);
  entries["sounds/attack.wav"] = wav;
  archive = { format: "char2d-character", version: 1, name: "Archive Knight", description: "Exported knight", style: { chromaKey: "#FF00FF", logicalHeight: 128, paletteSize: 24, outline: false, mirrorLeft: true }, palette: ["#123456"], sheet: "sheet.png", anchors: { right: "anchors/right.png" }, bindings: { p1: { jump: [], attack: ["KeyJ"] }, p2: { attack: ["Numpad1"] } }, actions: {} };
  for (const key of ["idle", "walk", "jump", "attack"]) {
    const file = `frames/${key}/right/001.png`, second = `frames/${key}/right/002.png`;
    entries[file] = frame; entries[second] = await sharp(frame).flop().png().toBuffer();
    archive.actions[key] = { label: key === "attack" ? "Sword attack" : key, playback: key === "jump" ? "once_hold" : "loop", gameplay: { trigger: key === "attack" || key === "jump" ? "press" : "hold", lockMovement: key === "attack", interruptible: true, ...(key === "walk" ? { moveSpeed: 120 } : {}) }, directions: { right: { frames: [{ file, w: 12, h: 16, anchorX: 5.25, anchorY: 17, scale: 0.8, durationMs: 100 }, { file: second, w: 12, h: 16, anchorX: 6.75, anchorY: 17, scale: 0.8, durationMs: 180 }] }, left: { mirrorOf: "right" } }, ...(key === "attack" ? { sound: { file: "sounds/attack.wav", frames: [1], volume: 0.35 }, events: [{ frame: 1, name: "hit" }] } : {}) };
  }
});

afterEach(() => {
  globalDb.char2dDb?.sqlite.close(); globalDb.char2dDb = previous;
  rmSync(state.config.dataDir, { recursive: true, force: true });
});

it("imports a ready character, preserving all moves, frames, controls and sound without AI jobs", async () => {
  const result = await importCharacterZip(zip());
  const character = getCharacter(result.id)!;
  expect(result.imageCalls).toBe(0);
  expect(character.status).toBe("ready");
  expect(character.sheet?.status).toBe("accepted");
  expect(character.name).toBe(archive.name);
  expect(character.animation?.actions).toHaveLength(4);
  expect(character.manifest!.actions.attack.gameplay.lockMovement).toBe(true);
  expect(character.manifest!.actions.idle.directions.left).toEqual({ mirrorOf: "right" });
  expect(character.manifest!.actions.jump.playback).toBe("once_hold");
  expect(character.manifest!.actions.idle.directions.right!.frames!.map(frame => [frame.anchorX, frame.anchorY, frame.scale, frame.durationMs])).toEqual([[5.25, 17, 0.8, 100], [6.75, 17, 0.8, 180]]);
  expect(character.bindings.p1.attack).toEqual(["KeyJ"]);
  expect(character.bindings.p2.attack).toEqual(["Numpad1"]);
  expect(character.bindings.p1.jump).toBeUndefined();
  expect(character.manifest!.actions.attack.sound).toMatchObject({ frames: [1], volume: 0.35 });
  expect(getDatabase().db.select().from(jobs).all()).toHaveLength(0);
  expect(getDatabase().db.select().from(actionVersions).all()).toHaveLength(4);
  expect(state.generate).not.toHaveBeenCalled(); expect(state.chat).not.toHaveBeenCalled();
});

it("exports every direction's PNGs and imports the ZIP again as an independent playable copy", async () => {
  const first = await importCharacterZip(zip());
  const exported = await exportCharacterZip(first.id);
  expect(exported.filename).toBe("Archive-Knight-frames.zip");
  const files = unzipSync(exported.bytes);
  expect(Object.keys(files).filter(path => path.startsWith("frames/"))).toHaveLength(16);
  expect(files["atlas.png"]).toBeTruthy(); expect(files["sheet.png"]).toBeTruthy();
  const portable = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  expect(portable.atlas.url).toBe("atlas.png");
  expect(portable.actions.attack.sound.url).toBe("sounds/attack.wav");
  const expectedLeft = await sharp(entries["frames/idle/right/001.png"]).flop().png().toBuffer();
  expect(await rgba(files["frames/idle/left/001.png"])).toEqual(await rgba(expectedLeft));
  const second = await importCharacterZip(exported.bytes, "Restored Knight");
  expect(second.id).not.toBe(first.id);
  expect(getCharacter(second.id)!.name).toBe("Restored Knight");
  expect(await rgba(await atlas(second.id))).toEqual(await rgba(await atlas(first.id)));
  expect(getCharacter(first.id)!.name).toBe("Archive Knight");
  expect(getDatabase().db.select().from(assets).where(eq(assets.characterId, second.id)).all().every(asset => asset.characterId === second.id)).toBe(true);
});

it("supports retiming and deleting an imported move with a local atlas rebuild", async () => {
  const { id } = await importCharacterZip(zip());
  updateAction(id, "idle", { durationsMs: [200, 400] });
  expect(getCharacter(id)!.manifest!.actions.idle.directions.right!.frames!.map(frame => frame.durationMs)).toEqual([200, 400]);
  deleteAction(id, "attack");
  const queue = new JobQueue();
  for (let job = queue.claim("archive-test"); job; job = queue.claim("archive-test")) { await runAnimationJob(job, queue); queue.complete(job.id); }
  expect(getCharacter(id)!.manifest!.actions.attack).toBeUndefined();
  expect(getCharacter(id)!.status).toBe("ready");
  expect(state.generate).not.toHaveBeenCalled(); expect(state.chat).not.toHaveBeenCalled();
});

it("rejects damaged archives, missing frames, invalid PNGs and incompatible metadata without creating records", async () => {
  await expect(importCharacterZip(Buffer.from("not a zip"))).rejects.toThrow(/ZIP/);
  await expect(importCharacterZip(Buffer.from(zipSync({ "frames/test.png": entries["sheet.png"] })))).rejects.toThrow(/character.json/);
  const missing = { ...entries }; delete missing["frames/idle/right/001.png"];
  await expect(importCharacterZip(zip(archive, missing))).rejects.toThrow(/missing a PNG/);
  await expect(importCharacterZip(zip(archive, { ...entries, "sheet.png": Buffer.from("invalid") }))).rejects.toThrow(/invalid or oversized PNG/);
  const bad = structuredClone(archive);
  const right = bad.actions.idle.directions.right!;
  if ("frames" in right) right.frames[0].w = 13;
  await expect(importCharacterZip(zip(bad))).rejects.toThrow(/dimensions/);
  bad.actions.idle.directions.left = { mirrorOf: "left" };
  await expect(importCharacterZip(zip(bad))).rejects.toThrow();
  expect(getDatabase().db.select().from(characters).all()).toHaveLength(0);
  expect(getDatabase().db.select().from(assets).all()).toHaveLength(0);
});

it("rejects unsafe paths, duplicate names, oversized decompression and conflicting bindings", async () => {
  expect(() => readCharacterZip(Buffer.from(zipSync({ "../escape.png": entries["sheet.png"] })))).toThrow(/path/);
  const duplicate = Buffer.from(zipSync({ "a.txt": strToU8("a"), "b.txt": strToU8("b") }));
  for (let index = duplicate.indexOf("b.txt"); index >= 0; index = duplicate.indexOf("b.txt", index + 5)) duplicate.write("a.txt", index);
  expect(() => readCharacterZip(duplicate)).toThrow(/duplicate/);
  const oversized = Buffer.from(zipSync({ "data.txt": strToU8("a") }));
  oversized.writeUInt32LE(500_000_000, 22);
  expect(() => readCharacterZip(oversized)).toThrow(/allowed size/);
  const conflicting = structuredClone(archive);
  conflicting.bindings.p2.attack = ["KeyJ"];
  await expect(importCharacterZip(zip(conflicting))).rejects.toThrow(/conflicting/);
  expect(getDatabase().db.select().from(characters).all()).toHaveLength(0);
});

it("returns clear errors when a character is missing or has no finished animations", async () => {
  await expect(exportCharacterZip("missing")).rejects.toMatchObject({ status: 404 });
  getDatabase().db.insert(characters).values({ id: "draft", name: "Draft", viewType: "side_scroller", createdAt: 1, updatedAt: 1 }).run();
  await expect(exportCharacterZip("draft")).rejects.toMatchObject({ status: 409 });
});
