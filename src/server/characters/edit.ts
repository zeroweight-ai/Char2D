import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "../db";
import { actions, actionVersions, characters, jobs } from "../db/schema";
import { JobQueue } from "../jobs/queue";
import { framesSchema } from "../pipeline/animation-types";
import { gameplaySchema, manifestSchema, storedActionPlanSchema } from "@/lib/manifest";

export class EditError extends Error { constructor(message: string, public status = 409) { super(message); } }

export const MIN_FRAME_MS = 20, MAX_FRAME_MS = 2000;
export const actionPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  durationsMs: z.array(z.number().int().min(MIN_FRAME_MS).max(MAX_FRAME_MS)).min(1).optional(),
  playback: z.enum(["loop", "once", "once_hold"]).optional(),
  gameplay: gameplaySchema.optional(),
}).refine(patch => Object.values(patch).some(value => value !== undefined), "Nothing to update");
export type ActionPatch = z.infer<typeof actionPatchSchema>;

function assertIdle(characterId: string) {
  const { db } = getDatabase();
  if (db.select().from(jobs).where(and(eq(jobs.characterId, characterId), ne(jobs.type, "sound"), inArray(jobs.status, ["queued", "running"]))).get())
    throw new EditError("Animations are still generating. Wait for them to finish first.");
}
function load(characterId: string, key: string) {
  const { db } = getDatabase();
  const character = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!character) throw new EditError("Character not found", 404);
  const action = db.select().from(actions).where(and(eq(actions.characterId, characterId), eq(actions.key, key))).get();
  if (!action) throw new EditError("Action not found", 404);
  return { character, action };
}

/**
 * Manual retime / gameplay / label / playback (PLAN §6.4): zero image calls.
 * Durations live on the active version, so undo/redo restores each version's
 * own timing; the published manifest is patched in place (atlas unchanged).
 */
export function updateAction(characterId: string, key: string, patch: ActionPatch) {
  const { db, sqlite } = getDatabase();
  return sqlite.transaction(() => {
    assertIdle(characterId);
    const { character, action } = load(characterId, key);
    const version = action.activeVersionId ? db.select().from(actionVersions).where(and(eq(actionVersions.id, action.activeVersionId), eq(actionVersions.actionId, action.id), eq(actionVersions.status, "ready"))).get() : null;
    if ((patch.durationsMs || patch.playback) && !version) throw new EditError("This action has no published version to retime yet.");
    if (version && (patch.durationsMs || patch.playback)) {
      const plan = storedActionPlanSchema.parse(JSON.parse(version.planJson));
      const frames = framesSchema.parse(JSON.parse(version.framesJson));
      if (patch.durationsMs) {
        if (patch.durationsMs.length !== plan.frames) throw new EditError(`Expected ${plan.frames} frame durations`, 400);
        plan.durationsMs = patch.durationsMs;
        for (const list of Object.values(frames)) list?.forEach((frame, i) => { frame.durationMs = patch.durationsMs![i] ?? frame.durationMs; });
      }
      if (patch.playback) plan.playback = patch.playback;
      db.update(actionVersions).set({ planJson: JSON.stringify(storedActionPlanSchema.parse(plan)), framesJson: JSON.stringify(frames) }).where(eq(actionVersions.id, version.id)).run();
    }
    db.update(actions).set({
      ...(patch.label ? { label: patch.label } : {}),
      ...(patch.gameplay ? { gameplayJson: JSON.stringify(patch.gameplay) } : {}),
      updatedAt: Date.now(),
    }).where(eq(actions.id, action.id)).run();
    if (character.manifestJson) {
      const manifest = manifestSchema.parse(JSON.parse(character.manifestJson));
      const entry = manifest.actions[key];
      if (entry) {
        if (patch.label) entry.label = patch.label;
        if (patch.playback) entry.playback = patch.playback;
        if (patch.gameplay) entry.gameplay = patch.gameplay;
        if (patch.durationsMs) for (const direction of Object.values(entry.directions)) direction?.frames?.forEach((frame, i) => { frame.durationMs = patch.durationsMs![i] ?? frame.durationMs; });
        db.update(characters).set({ manifestJson: JSON.stringify(manifestSchema.parse(manifest)), updatedAt: Date.now() }).where(eq(characters.id, characterId)).run();
      }
    }
    return { ok: true, imageCalls: 0 };
  }).immediate();
}

/** Undo/redo: publish another ready version of one action (no AI call). */
export function activateVersion(characterId: string, key: string, versionId: string) {
  const { db, sqlite } = getDatabase();
  return sqlite.transaction(() => {
    assertIdle(characterId);
    const { character, action } = load(characterId, key);
    if (!character.sheetId) throw new EditError("Accept a character sheet first.");
    const target = db.select().from(actionVersions).where(and(eq(actionVersions.id, versionId), eq(actionVersions.actionId, action.id))).get();
    if (!target) throw new EditError("Version not found", 404);
    if (target.status !== "ready") throw new EditError("Only finished versions can be restored.");
    if (action.activeVersionId === target.id) return { jobId: null, imageCalls: 0 };
    const versionIds = db.select().from(actions).where(eq(actions.characterId, characterId)).orderBy(actions.sortOrder, actions.createdAt).all().flatMap(item => {
      if (item.id === action.id) return [target.id];
      const active = item.activeVersionId ? db.select().from(actionVersions).where(and(eq(actionVersions.id, item.activeVersionId), eq(actionVersions.status, "ready"))).get() : null;
      const fallback = active ?? db.select().from(actionVersions).where(and(eq(actionVersions.actionId, item.id), eq(actionVersions.status, "ready"))).orderBy(desc(actionVersions.version)).get();
      return fallback ? [fallback.id] : [];
    });
    const jobId = new JobQueue().enqueue("compose_atlas", { sheetId: character.sheetId, versionIds }, { characterId, maxAttempts: 1 });
    db.update(characters).set({ status: "generating", updatedAt: Date.now() }).where(eq(characters.id, characterId)).run();
    return { jobId, imageCalls: 0 };
  }).immediate();
}
