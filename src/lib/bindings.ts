import { z } from "zod";
import type { Direction } from "./manifest";

// Key bindings (PLAN §6.5). Codes are KeyboardEvent.code values, so they are
// layout-independent. Movement keys are fixed per profile and drive Walk; every
// other action except Idle is bindable.
export const profileSchema = z.enum(["p1", "p2"]);
export type Profile = z.infer<typeof profileSchema>;
export const PROFILES: Profile[] = ["p1", "p2"];
export const profileLabels: Record<Profile, string> = { p1: "Player 1", p2: "Player 2" };
/** Action key → bound codes, per profile. */
export type Bindings = Record<Profile, Record<string, string[]>>;

/** Keys the capture dialog itself uses, plus focus navigation. */
export const RESERVED_CODES = new Set(["Escape", "Backspace", "Tab"]);
export const LOCOMOTION_ACTIONS = new Set(["idle", "walk"]);
export const MAX_CODES_PER_ACTION = 3;
const CUSTOM_POOL: Record<Profile, string[]> = {
  p1: ["KeyJ", "KeyK", "KeyL", "KeyU", "KeyI", "KeyO"],
  p2: ["Numpad1", "Numpad2", "Numpad3", "Numpad4", "Numpad5", "Numpad6"],
};

export function movementKeys(profile: Profile): Record<string, Direction> {
  return profile === "p1" ? { KeyA: "left", KeyD: "right" } : { ArrowLeft: "left", ArrowRight: "right" };
}
export function isBindable(actionKey: string) { return !LOCOMOTION_ACTIONS.has(actionKey); }

/** Default codes for a newly seen action, skipping codes already taken. */
export function defaultCodes(profile: Profile, actionKey: string, taken: Set<string>): string[] {
  if (!isBindable(actionKey)) return [];
  const preset: Record<string, Record<Profile, string[]>> = { jump: { p1: ["KeyW", "Space"], p2: ["ArrowUp"] }, crouch: { p1: ["KeyS"], p2: ["ArrowDown"] } };
  const wanted = preset[actionKey]?.[profile];
  if (wanted) return wanted.filter(code => !taken.has(code));
  const free = CUSTOM_POOL[profile].find(code => !taken.has(code));
  return free ? [free] : [];
}

const NAMED: Record<string, string> = {
  Space: "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "Enter",
  ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl", AltLeft: "L-Alt", AltRight: "R-Alt",
  Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", Backslash: "\\",
};
export function keyLabel(code: string) {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  return code.replace(/^Numpad/, "Num");
}

export const codeSchema = z.string().regex(/^[A-Za-z0-9]{1,32}$/, "Invalid key code").refine(code => !RESERVED_CODES.has(code), "That key is reserved");
export const bindingsInputSchema = z.object({
  profile: profileSchema,
  bindings: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,47}$/), z.array(codeSchema).max(MAX_CODES_PER_ACTION)),
});

export type Conflict = { code: string; message: string };
/**
 * Validates a full binding set. One key does exactly one thing across both
 * profiles, so two players can share a keyboard in the Playground.
 */
export function findConflicts(bindings: Bindings, labels: Record<string, string>): Conflict[] {
  const owner = new Map<string, string>(), conflicts: Conflict[] = [];
  for (const profile of PROFILES) for (const [code, direction] of Object.entries(movementKeys(profile))) owner.set(code, `${profileLabels[profile]} move ${direction}`);
  for (const profile of PROFILES) for (const [action, codes] of Object.entries(bindings[profile] ?? {})) for (const code of codes) {
    const name = `${labels[action] ?? action} (${profileLabels[profile]})`;
    const existing = owner.get(code);
    if (existing && existing !== name) conflicts.push({ code, message: `${keyLabel(code)} is already used by ${existing}.` });
    else owner.set(code, name);
  }
  return conflicts;
}
/** The action/profile already holding a code, if any (for "swap?" prompts). */
export function codeOwner(bindings: Bindings, code: string): { profile: Profile; action: string | null } | null {
  for (const profile of PROFILES) {
    if (movementKeys(profile)[code]) return { profile, action: null };
    for (const [action, codes] of Object.entries(bindings[profile] ?? {})) if (codes.includes(code)) return { profile, action };
  }
  return null;
}
