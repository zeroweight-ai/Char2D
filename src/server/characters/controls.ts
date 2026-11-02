import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDatabase } from "../db";
import { actions, characters, inputBindings } from "../db/schema";
import { gameplaySchema } from "@/lib/manifest";
import { PROFILES, defaultCodes, findConflicts, isBindable, movementKeys, type Bindings, type Profile } from "@/lib/bindings";

export class ControlsError extends Error { constructor(message: string, public status = 409) { super(message); } }

function triggerFor(gameplayJson: string) {
  const parsed = gameplaySchema.safeParse(JSON.parse(gameplayJson));
  return parsed.success ? parsed.data.trigger : "press";
}

function readBindings(characterId: string): Bindings {
  const { db } = getDatabase();
  const rows = db.select({ profile: inputBindings.profile, code: inputBindings.code, key: actions.key })
    .from(inputBindings).innerJoin(actions, eq(actions.id, inputBindings.actionId))
    .where(and(eq(inputBindings.characterId, characterId), eq(inputBindings.device, "keyboard"))).all();
  const result: Bindings = { p1: {}, p2: {} };
  // Legacy rows bound Walk to movement keys; movement is fixed, so skip them.
  for (const row of rows) if (isBindable(row.key)) (result[row.profile][row.key] ??= []).push(row.code);
  return result;
}

/** Assigns default keys to actions that have never had bindings, once. */
export function ensureBindings(characterId: string) {
  const { db, sqlite } = getDatabase();
  const pending = db.select({ id: actions.id }).from(actions).where(and(eq(actions.characterId, characterId), eq(actions.bindingsSeeded, false))).all();
  if (!pending.length) return;
  sqlite.transaction(() => {
    const character = db.select().from(characters).where(eq(characters.id, characterId)).get();
    if (!character) return;
    const list = db.select().from(actions).where(and(eq(actions.characterId, characterId), eq(actions.bindingsSeeded, false))).orderBy(actions.sortOrder, actions.createdAt).all();
    const taken = new Set(db.select({ code: inputBindings.code }).from(inputBindings).where(eq(inputBindings.characterId, characterId)).all().map(row => row.code));
    for (const profile of PROFILES) for (const code of Object.keys(movementKeys(character.viewType, profile))) taken.add(code);
    for (const action of list) {
      for (const profile of PROFILES) for (const code of defaultCodes(character.viewType, profile, action.key, taken)) {
        taken.add(code);
        db.insert(inputBindings).values({ id: nanoid(), characterId, profile, actionId: action.id, device: "keyboard", code, trigger: triggerFor(action.gameplayJson) }).run();
      }
      db.update(actions).set({ bindingsSeeded: true }).where(eq(actions.id, action.id)).run();
    }
  }).immediate();
}

export function getBindings(characterId: string): Bindings {
  ensureBindings(characterId);
  return readBindings(characterId);
}

/** Replaces one profile's keyboard bindings after validating the full set. */
export function replaceBindings(characterId: string, profile: Profile, next: Record<string, string[]>): Bindings {
  const { db, sqlite } = getDatabase();
  ensureBindings(characterId);
  sqlite.transaction(() => {
    const character = db.select().from(characters).where(eq(characters.id, characterId)).get();
    if (!character) throw new ControlsError("Character not found", 404);
    const list = db.select().from(actions).where(eq(actions.characterId, characterId)).all();
    const byKey = new Map(list.map(action => [action.key, action]));
    for (const [key, codes] of Object.entries(next)) {
      if (!byKey.has(key)) throw new ControlsError(`Unknown action "${key}"`, 400);
      if (!isBindable(key) && codes.length) throw new ControlsError(`${byKey.get(key)!.label} follows the movement keys and can’t be bound`, 400);
      if (new Set(codes).size !== codes.length) throw new ControlsError(`${byKey.get(key)!.label} lists the same key twice`, 400);
    }
    const merged: Bindings = { ...readBindings(characterId), [profile]: next };
    const conflicts = findConflicts(character.viewType, merged, Object.fromEntries(list.map(action => [action.key, action.label])));
    if (conflicts.length) throw new ControlsError(conflicts[0].message);
    db.delete(inputBindings).where(and(eq(inputBindings.characterId, characterId), eq(inputBindings.profile, profile), eq(inputBindings.device, "keyboard"))).run();
    for (const [key, codes] of Object.entries(next)) {
      const action = byKey.get(key)!;
      for (const code of codes) db.insert(inputBindings).values({ id: nanoid(), characterId, profile, actionId: action.id, device: "keyboard", code, trigger: triggerFor(action.gameplayJson) }).run();
    }
  }).immediate();
  return readBindings(characterId);
}
