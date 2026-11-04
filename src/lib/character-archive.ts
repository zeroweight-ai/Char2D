import { z } from "zod";
import { styleSchema } from "./character";
import { codeSchema, MAX_CODES_PER_ACTION } from "./bindings";
import { directionSchema, gameplaySchema, storedActionPlanSchema } from "./manifest";

export const MAX_CHARACTER_ZIP_BYTES = 100 * 1024 * 1024;
export const archivePathSchema = z.string().min(1).max(240).regex(/^[a-zA-Z0-9_./-]+$/).refine(path =>
  path.split("/").every(part => part !== "" && part !== "." && part !== ".."), "Invalid file path in character ZIP");
const keySchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const frameSchema = z.object({ file: archivePathSchema, w: z.number().int().positive().max(8192), h: z.number().int().positive().max(8192), anchorX: z.number(), anchorY: z.number(), scale: z.number().positive().optional(), durationMs: z.number().int().positive() });
export const characterArchiveSchema = z.object({
  format: z.literal("char2d-character"), version: z.literal(1),
  name: z.string().trim().min(1).max(80), description: z.string().max(2000),
  pixelScale: z.number().int().positive().max(64).optional(),
  style: styleSchema, palette: z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)).max(256),
  sheet: archivePathSchema, rawSheet: archivePathSchema.optional(),
  anchors: z.partialRecord(directionSchema, archivePathSchema).default({}),
  bindings: z.object({ p1: z.record(keySchema, z.array(codeSchema).max(MAX_CODES_PER_ACTION)), p2: z.record(keySchema, z.array(codeSchema).max(MAX_CODES_PER_ACTION)) }),
  actions: z.record(keySchema, z.object({
    label: z.string().min(1).max(80), playback: z.enum(["loop", "once", "once_hold"]), gameplay: gameplaySchema,
    plan: storedActionPlanSchema.optional(),
    events: z.array(z.object({ frame: z.number().int().nonnegative(), name: z.string().min(1) })).optional(),
    directions: z.partialRecord(directionSchema, z.union([z.object({ mirrorOf: directionSchema }), z.object({ frames: z.array(frameSchema).min(1).max(60) })])),
    sound: z.object({ file: archivePathSchema, frames: z.array(z.number().int().nonnegative()).min(1), volume: z.number().min(0).max(1).optional() }).optional(),
  })).refine(actions => Object.keys(actions).length > 0 && Object.keys(actions).length <= 128, "ZIP must contain between 1 and 128 moves"),
});
export type CharacterArchive = z.infer<typeof characterArchiveSchema>;
