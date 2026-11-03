import { z } from "zod";
// Per-action sound effect state, stored in actions.sound_json and returned by
// getCharacter. "{}" (no status) means the AI has not decided yet.
//  none: the AI decided the move is silent (reason says why)
//  queued/generating: a sound job is pending; ready: assetId is published
export const soundStatusSchema=z.enum(["none","queued","generating","ready","error"]);
export const soundStateSchema=z.object({
  status:soundStatusSchema.optional(),
  reason:z.string().optional(),
  prompt:z.string().optional(),
  assetId:z.string().optional(),
  // A bundled sound (public/sounds, src/lib/default-sounds.ts) instead of an asset.
  builtin:z.string().optional(),
  // 0-based frame indices on which the sound starts (e.g. walk foot contacts).
  frames:z.array(z.number().int().nonnegative()).optional(),
  durationSeconds:z.number().positive().optional(),
  volume:z.number().min(0).max(1).optional(),
  error:z.string().optional(),
  // "ai" when the AI chose; "user" when the player asked for a sound.
  requestedBy:z.enum(["ai","user","default"]).optional(),
  updatedAt:z.number().optional(),
});
export type SoundState=z.infer<typeof soundStateSchema>;
export function parseSoundState(json:string|null|undefined):SoundState {
  try{const parsed=soundStateSchema.safeParse(JSON.parse(json||"{}"));return parsed.success?parsed.data:{};}catch{return {};}
}
// The published manifest entry: play `url` whenever playback enters one of `frames`.
export const manifestSoundSchema=z.object({url:z.string().min(1),frames:z.array(z.number().int().nonnegative()).min(1),volume:z.number().min(0).max(1).optional()});
export type ManifestSound=z.infer<typeof manifestSoundSchema>;
/** Manifest entry for a ready sound, with trigger frames clamped to the action's frame count. */
export function manifestSound(state:SoundState,frameCount:number):ManifestSound|undefined {
  // Queued/generating/error keep the previously published sound until replaced.
  if(state.status==="none"||!(state.assetId||state.builtin)||frameCount<1)return undefined;
  const frames=[...new Set((state.frames??[0]).filter(frame=>frame<frameCount))].sort((a,b)=>a-b);
  return {url:state.builtin??`/api/assets/${state.assetId}`,frames:frames.length?frames:[0],...(state.volume!==undefined?{volume:state.volume}:{})};
}
