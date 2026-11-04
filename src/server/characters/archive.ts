import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { characterArchiveSchema, MAX_CHARACTER_ZIP_BYTES, type CharacterArchive } from "@/lib/character-archive";
import { styleSchema } from "@/lib/character";
import { directionSchema, manifestSchema, storedActionPlanSchema, type Manifest, type Direction } from "@/lib/manifest";
import { findConflicts, isBindable, PROFILES } from "@/lib/bindings";
import { getDatabase } from "../db";
import { actions, actionVersions, characters, characterSheets, inputBindings } from "../db/schema";
import { readAsset, saveAsset } from "../storage/assets";
import { framesSchema, type FrameRef } from "../pipeline/animation-types";
import { getBindings } from "./controls";
import { deleteCharacter } from "./delete";
import { CharacterArchiveError, readCharacterZip } from "./archive-zip";

export { CharacterArchiveError } from "./archive-zip";
const MAX_PIXELS = 120_000_000;
const framePath = (key: string, direction: string, index: number) => `frames/${key}/${direction}/${String(index + 1).padStart(3, "0")}.png`;

export async function exportCharacterZip(id: string) {
  const { db } = getDatabase();
  const character = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!character) throw new CharacterArchiveError("Character not found", 404);
  if (!character.manifestJson || !character.atlasAssetId) throw new CharacterArchiveError("Wait for the character's animations to finish before exporting.", 409);
  const sheet = character.sheetId ? db.select().from(characterSheets).where(and(eq(characterSheets.id, character.sheetId), eq(characterSheets.characterId, id))).get() : null;
  if (!sheet?.processedAssetId) throw new CharacterArchiveError("This character has no accepted sheet to export.", 409);
  const manifest = manifestSchema.parse(JSON.parse(character.manifestJson));
  const load = async (assetId: string) => {
    const result = await readAsset(assetId);
    if (!result || result.asset.characterId !== id) throw new CharacterArchiveError("A character asset is missing. Please restore it before exporting.", 409);
    return result;
  };
  const files: Record<string, Uint8Array> = Object.create(null);
  let bytes = 0;
  function add(path: string, data: Uint8Array) {
    bytes += data.byteLength;
    if (bytes > MAX_CHARACTER_ZIP_BYTES - 65536) throw new CharacterArchiveError("This character is too large for a 100 MB ZIP.", 413);
    files[path] = data;
  }
  const atlas = (await load(character.atlasAssetId)).bytes;
  add("atlas.png", atlas);
  add("sheet.png", (await load(sheet.processedAssetId)).bytes);
  const bundle: CharacterArchive = {
    format: "char2d-character", version: 1, name: character.name, description: character.description,
    pixelScale: manifest.pixelScale,
    style: styleSchema.parse(JSON.parse(character.styleJson)), palette: JSON.parse(character.paletteJson), sheet: "sheet.png",
    anchors: {}, bindings: getBindings(id), actions: Object.create(null),
  };
  if (sheet.rawAssetId) { add("sheet-raw.png", (await load(sheet.rawAssetId)).bytes); bundle.rawSheet = "sheet-raw.png"; }
  for (const [direction, assetId] of Object.entries(JSON.parse(sheet.anchorsJson))) {
    if (!directionSchema.safeParse(direction).success || typeof assetId !== "string") continue;
    const path = `anchors/${direction}.png`;
    add(path, (await load(assetId)).bytes);
    bundle.anchors[direction as Direction] = path;
  }
  const portable = structuredClone(manifest);
  portable.atlas.url = "atlas.png";
  for (const [key, action] of Object.entries(manifest.actions)) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) throw new CharacterArchiveError("A move has an unsupported export key.", 409);
    const saved = db.select().from(actions).where(and(eq(actions.characterId, id), eq(actions.key, key))).get();
    const active = saved?.activeVersionId ? db.select().from(actionVersions).where(and(eq(actionVersions.id, saved.activeVersionId), eq(actionVersions.actionId, saved.id))).get() : null;
    const plan = active ? storedActionPlanSchema.safeParse(JSON.parse(active.planJson)) : null;
    const exported: CharacterArchive["actions"][string] = {
      label: action.label, playback: action.playback, gameplay: action.gameplay, events: action.events,
      directions: {}, ...(plan?.success ? { plan: plan.data } : {}),
    };
    const images = new Map<string, Buffer[]>();
    for (const [direction, selection] of Object.entries(action.directions)) {
      if (!selection.frames) continue;
      const frames = [], pngs: Buffer[] = [];
      for (const [index, frame] of selection.frames.entries()) {
        const png = await sharp(atlas, { limitInputPixels: MAX_PIXELS }).extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h }).png().toBuffer();
        const path = framePath(key, direction, index);
        add(path, png); pngs.push(png);
        const { w, h, anchorX, anchorY, scale, durationMs } = frame;
        frames.push({ file: path, w, h, anchorX, anchorY, scale, durationMs });
      }
      images.set(direction, pngs);
      exported.directions[direction as Direction] = { frames };
    }
    for (const [direction, selection] of Object.entries(action.directions)) if (selection.mirrorOf) {
      exported.directions[direction as Direction] = { mirrorOf: selection.mirrorOf };
      const source = images.get(selection.mirrorOf);
      if (!source) throw new CharacterArchiveError("A mirrored move has no source frames.", 409);
      for (const [index, png] of source.entries()) add(framePath(key, direction, index), await sharp(png).flop().png().toBuffer());
    }
    if (action.sound) {
      let sound: Buffer, extension: string;
      const assetId = /^\/api\/assets\/([a-zA-Z0-9_-]+)$/.exec(action.sound.url)?.[1];
      if (assetId) {
        const asset = await load(assetId);
        if (!["audio/mpeg", "audio/wav"].includes(asset.asset.mime)) throw new CharacterArchiveError("A sound asset has an unsupported format.", 409);
        sound = asset.bytes; extension = asset.asset.mime === "audio/wav" ? "wav" : "mp3";
      } else if (/^\/sounds\/[a-zA-Z0-9_-]+\.mp3$/.test(action.sound.url)) {
        sound = await readFile(join(process.cwd(), "public", action.sound.url.slice(1))); extension = "mp3";
      } else throw new CharacterArchiveError("A sound cannot be included in this character ZIP.", 409);
      const path = `sounds/${key}.${extension}`;
      add(path, sound);
      exported.sound = { file: path, frames: action.sound.frames, volume: action.sound.volume };
      portable.actions[key].sound!.url = path;
    }
    bundle.actions[key] = exported;
  }
  add("character.json", strToU8(JSON.stringify(characterArchiveSchema.parse(bundle), null, 2)));
  add("manifest.json", strToU8(JSON.stringify(portable, null, 2)));
  add("README.txt", strToU8("Char2D character archive v1\n\nframes/<move>/<direction>/ contains every published frame as a native-resolution PNG, including mirrored directions.\ncharacter.json preserves timing, anchors, scale, controls, gameplay, sounds and character details for reimport.\nmanifest.json and atlas.png can be used in a game engine.\nUpload this ZIP using Create a character > Upload a ZIP to restore a playable copy without AI generation.\nOnly published moves are included; historical versions and raw animation strips are not included.\n"));
  const zip = Buffer.from(zipSync(files, { level: 0 }));
  if (zip.length > MAX_CHARACTER_ZIP_BYTES) throw new CharacterArchiveError("This character is too large for a 100 MB ZIP.", 413);
  return { bytes: zip, filename: `${character.name.replace(/[^a-z0-9_-]/gi, "-") || "character"}-frames.zip` };
}

/** Validate and decode everything before creating any character or asset rows. */
export async function importCharacterZip(bytes: Buffer, rename = "") {
  const files = readCharacterZip(bytes);
  const metadata = files.get("character.json");
  if (!metadata || metadata.length > 4 * 1024 * 1024) throw new CharacterArchiveError("Choose a character ZIP downloaded from Char2D; character.json is missing or too large.");
  let bundle: CharacterArchive;
  try { bundle = characterArchiveSchema.parse(JSON.parse(metadata.toString("utf8"))); }
  catch { throw new CharacterArchiveError("The ZIP's character details are invalid or from an unsupported archive version."); }
  const name = rename.trim() || bundle.name;
  if (name.length > 80) throw new CharacterArchiveError("Character names must be 80 characters or fewer.");
  const labels = Object.fromEntries(Object.entries(bundle.actions).map(([key, action]) => [key, action.label]));
  const allCodes = PROFILES.flatMap(profile => Object.values(bundle.bindings[profile]).flat());
  if (new Set(allCodes).size !== allCodes.length) throw new CharacterArchiveError("The ZIP contains conflicting character controls.");
  for (const profile of PROFILES) for (const [key, codes] of Object.entries(bundle.bindings[profile])) {
    if (!Object.hasOwn(bundle.actions, key) || !isBindable(key) && codes.length || new Set(codes).size !== codes.length) throw new CharacterArchiveError("The ZIP contains invalid character controls.");
  }
  if (findConflicts(bundle.bindings, labels).length) throw new CharacterArchiveError("The ZIP contains conflicting character controls.");
  const decoded = new Map<string, { png: Buffer; width: number; height: number }>();
  let pixels = 0, frameCount = 0;
  async function image(path: string) {
    const previous = decoded.get(path);
    if (previous) return previous;
    const png = files.get(path);
    if (!png?.length || !path.endsWith(".png")) throw new CharacterArchiveError(`The ZIP is missing a PNG: ${path}`);
    try {
      const input = sharp(png, { limitInputPixels: 24_000_000, animated: false });
      const info = await input.metadata();
      if (info.format !== "png" || !info.width || !info.height || (info.pages ?? 1) !== 1) throw new Error("Not a single PNG");
      pixels += info.width * info.height;
      if (pixels > MAX_PIXELS) throw new CharacterArchiveError("The ZIP contains too many image pixels.", 413);
      await input.stats();
      const result = { png, width: info.width, height: info.height };
      decoded.set(path, result);
      return result;
    } catch (error) {
      if (error instanceof CharacterArchiveError) throw error;
      throw new CharacterArchiveError(`The ZIP contains an invalid or oversized PNG: ${path}`);
    }
  }
  await image(bundle.sheet);
  if (bundle.rawSheet) await image(bundle.rawSheet);
  for (const path of Object.values(bundle.anchors)) await image(path);
  const audio = new Map<string, { bytes: Buffer; mime: "audio/mpeg" | "audio/wav" }>();
  for (const action of Object.values(bundle.actions)) {
    const selections = Object.values(action.directions);
    const concrete = selections.filter(selection => "frames" in selection);
    if (!concrete.length) throw new CharacterArchiveError("Every move needs at least one set of frames.");
    const count = concrete[0].frames.length;
    if (concrete.some(selection => selection.frames.length !== count) || action.plan && action.plan.frames !== count) throw new CharacterArchiveError("The ZIP contains inconsistent frame counts.");
    if (action.events?.some(event => event.frame >= count) || action.sound?.frames.some(frame => frame >= count)) throw new CharacterArchiveError("The ZIP contains an event outside its animation.");
    for (const [direction, selection] of Object.entries(action.directions)) {
      if ("mirrorOf" in selection) {
        const target = action.directions[selection.mirrorOf];
        if (direction === selection.mirrorOf || !target || !("frames" in target)) throw new CharacterArchiveError("A mirrored direction has no source frames.");
      } else for (const frame of selection.frames) {
        if (++frameCount > 1024) throw new CharacterArchiveError("The ZIP has too many animation frames.", 413);
        const png = await image(frame.file);
        if (png.width !== frame.w || png.height !== frame.h) throw new CharacterArchiveError("A frame's dimensions do not match its PNG.");
      }
    }
    if (action.sound) {
      const path = action.sound.file, data = files.get(path);
      const wav = path.endsWith(".wav");
      const valid = data && data.length <= 10 * 1024 * 1024 && (wav ? data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WAVE" : path.endsWith(".mp3") && (data.subarray(0, 3).toString() === "ID3" || data[0] === 255 && (data[1] & 224) === 224));
      if (!valid) throw new CharacterArchiveError("The ZIP contains a missing or unsupported sound.");
      audio.set(path, { bytes: data, mime: wav ? "audio/wav" : "audio/mpeg" });
    }
  }
  // Rebuild the atlas from the individual PNGs, rather than trusting an atlas
  // or old asset URLs supplied by the uploaded package.
  const rows: { key: string; direction: Direction; frames: Extract<CharacterArchive["actions"][string]["directions"][Direction], { frames: unknown }> ["frames"] }[] = [];
  let atlasWidth = 1, atlasHeight = 0;
  for (const [key, action] of Object.entries(bundle.actions)) for (const [direction, selection] of Object.entries(action.directions)) if ("frames" in selection) {
    rows.push({ key, direction: direction as Direction, frames: selection.frames });
    atlasWidth = Math.max(atlasWidth, selection.frames.reduce((sum, frame) => sum + frame.w, 0));
    atlasHeight += Math.max(...selection.frames.map(frame => frame.h));
  }
  if (atlasWidth > 32767 || atlasHeight > 32767 || atlasWidth * atlasHeight > MAX_PIXELS) throw new CharacterArchiveError("The imported atlas would be too large.", 413);
  const published: Manifest["actions"] = Object.create(null), composites: { input: Buffer; left: number; top: number }[] = [];
  for (const [key, action] of Object.entries(bundle.actions)) published[key] = { label: action.label, playback: action.playback, gameplay: action.gameplay, events: action.events, directions: {} };
  let top = 0;
  for (const row of rows) {
    let left = 0;
    published[row.key].directions[row.direction] = { frames: row.frames.map(frame => {
      composites.push({ input: decoded.get(frame.file)!.png, left, top });
      const result = { x: left, y: top, w: frame.w, h: frame.h, anchorX: frame.anchorX, anchorY: frame.anchorY, scale: frame.scale, durationMs: frame.durationMs };
      left += frame.w;
      return result;
    }) };
    top += Math.max(...row.frames.map(frame => frame.h));
  }
  for (const [key, action] of Object.entries(bundle.actions)) for (const [direction, selection] of Object.entries(action.directions)) if ("mirrorOf" in selection) published[key].directions[direction as Direction] = selection;
  const atlas = await sharp({ create: { width: atlasWidth, height: atlasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).png().toBuffer();
  const id = nanoid(), sheetId = nanoid(), now = Date.now(), { db, sqlite } = getDatabase();
  db.insert(characters).values({ id, name, description: bundle.description, viewType: "side_scroller", styleJson: JSON.stringify(bundle.style), paletteJson: JSON.stringify(bundle.palette), createdAt: now, updatedAt: now }).run();
  try {
    const imageAssets = new Map<string, string>();
    for (const [path, data] of decoded) {
      const asset = await saveAsset(data.png, { characterId: id, kind: path === bundle.sheet ? "sheet_transparent" : path === bundle.rawSheet ? "sheet_raw" : path.startsWith("anchors/") ? "sheet_identity_anchor" : "frame", mime: "image/png", width: data.width, height: data.height });
      imageAssets.set(path, asset.id);
    }
    const soundAssets = new Map<string, string>();
    for (const [path, sound] of audio) soundAssets.set(path, (await saveAsset(sound.bytes, { characterId: id, kind: "action_sound", mime: sound.mime })).id);
    const atlasAsset = await saveAsset(atlas, { characterId: id, kind: "atlas", mime: "image/png", width: atlasWidth, height: atlasHeight });
    const anchors = Object.fromEntries(Object.entries(bundle.anchors).map(([direction, path]) => [direction, imageAssets.get(path)!]));
    // Imported packages without an identity crop can use an existing concrete
    // animation frame as the reference for subsequent generated moves.
    for (const row of rows) anchors[row.direction] ??= imageAssets.get(row.frames[0].file)!;
    const versionRows: (typeof actionVersions.$inferInsert)[] = [], actionRows: (typeof actions.$inferInsert)[] = [], bindingRows: (typeof inputBindings.$inferInsert)[] = [];
    for (const [key, action] of Object.entries(bundle.actions)) {
      const actionId = nanoid(), versionId = nanoid();
      const concrete = Object.entries(action.directions).filter(([, selection]) => "frames" in selection);
      const first = concrete[0][1];
      if (!("frames" in first)) throw new Error("Missing frames");
      const frameRefs = Object.fromEntries(concrete.map(([direction, selection]) => [direction, "frames" in selection ? selection.frames.map(frame => ({ assetId: imageAssets.get(frame.file)!, w: frame.w, h: frame.h, anchorX: frame.anchorX, anchorY: frame.anchorY, scale: frame.scale ?? 1, durationMs: frame.durationMs } satisfies FrameRef)) : []]));
      const plan = storedActionPlanSchema.parse({ ...(action.plan ?? { summary: `Imported ${action.label}`, canvas: "standard", poses: first.frames.map((_, index) => `${action.label} frame ${index + 1}`) }), frames: first.frames.length, durationsMs: first.frames.map(frame => frame.durationMs), playback: action.playback, events: action.events });
      if (action.sound) published[key].sound = { url: `/api/assets/${soundAssets.get(action.sound.file)!}`, frames: action.sound.frames, volume: action.sound.volume };
      actionRows.push({ id: actionId, characterId: id, key, label: action.label, isDefault: ["idle", "walk", "jump", "crouch"].includes(key), directionsJson: JSON.stringify(concrete.map(([direction]) => direction)), activeVersionId: versionId, gameplayJson: JSON.stringify(action.gameplay), sortOrder: actionRows.length, bindingsSeeded: true, soundJson: JSON.stringify(action.sound ? { status: "ready", assetId: soundAssets.get(action.sound.file), frames: action.sound.frames, volume: action.sound.volume, requestedBy: "user" } : { status: "none", reason: "Imported without sound." }), createdAt: now, updatedAt: now });
      versionRows.push({ id: versionId, actionId, version: 1, planJson: JSON.stringify(plan), framesJson: JSON.stringify(framesSchema.parse(frameRefs)), stripsJson: "{}", status: "ready", createdBy: "manual", createdAt: now });
      for (const profile of PROFILES) for (const code of bundle.bindings[profile][key] ?? []) bindingRows.push({ id: nanoid(), characterId: id, profile, actionId, device: "keyboard", code, trigger: action.gameplay.trigger });
    }
    const manifest = manifestSchema.parse({ version: 1, characterId: id, viewType: "side_scroller", pixelScale: bundle.pixelScale ?? 1, atlas: { url: `/api/assets/${atlasAsset.id}`, width: atlasWidth, height: atlasHeight, version: 1 }, actions: published });
    await saveAsset(Buffer.from(JSON.stringify(manifest, null, 2)), { characterId: id, kind: "manifest", mime: "application/json" });
    sqlite.transaction(() => {
      const sheetInfo = decoded.get(bundle.sheet)!;
      db.insert(characterSheets).values({ id: sheetId, characterId: id, version: 1, status: "accepted", processedAssetId: imageAssets.get(bundle.sheet), rawAssetId: bundle.rawSheet ? imageAssets.get(bundle.rawSheet) : null, anchorsJson: JSON.stringify(anchors), viewsJson: JSON.stringify({ _sheetProcessing: { fullResolution: true, width: sheetInfo.width, height: sheetInfo.height } }), prompt: "Imported from a Char2D character ZIP", createdAt: now }).run();
      for (const row of actionRows) db.insert(actions).values(row).run();
      for (const row of versionRows) db.insert(actionVersions).values(row).run();
      for (const row of bindingRows) db.insert(inputBindings).values(row).run();
      db.update(characters).set({ sheetId, atlasAssetId: atlasAsset.id, atlasVersion: 1, manifestJson: JSON.stringify(manifest), status: "ready", updatedAt: now }).where(eq(characters.id, id)).run();
    }).immediate();
    return { id, imageCalls: 0 };
  } catch (error) {
    deleteCharacter(id);
    throw error;
  }
}
