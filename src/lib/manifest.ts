import { z } from "zod";
import { manifestSoundSchema } from "./sound";
export const directionSchema = z.enum(["right","left","up","down"]);
// Char2D makes side-view (side-scroller) characters only. The manifest keeps
// the field so the exported format stays stable for game engines.
export const viewTypeSchema = z.literal("side_scroller");
export const gameplaySchema = z.object({
  trigger:z.enum(["press","hold","toggle"]),lockMovement:z.boolean(),interruptible:z.boolean(),
  cooldownMs:z.number().nonnegative().optional(), rootMotion:z.object({dx:z.number(),dy:z.number(),overMs:z.number().positive()}).optional(),
  moveSpeed:z.number().nonnegative().optional(),jumpVelocity:z.number().optional(),gravityScale:z.number().positive().optional(),crouchSpeedMultiplier:z.number().nonnegative().optional(),
});
export const MAX_FRAMES_PER_ACTION = 4;
// Saved versions predate the four-frame generation limit.
export const storedActionPlanSchema = z.object({
  summary:z.string().min(1),frames:z.number().int().min(1).max(60),poses:z.array(z.string().min(1)),durationsMs:z.array(z.number().int().positive()),
  playback:z.enum(["loop","once","once_hold"]),canvas:z.enum(["standard","wide","tall"]),airborneFrames:z.array(z.number().int().nonnegative()).optional(),
  effects:z.string().optional(),events:z.array(z.object({frame:z.number().int().nonnegative(),name:z.string().min(1)})).optional(),
}).superRefine((plan,ctx) => {
  if(plan.poses.length!==plan.frames || plan.durationsMs.length!==plan.frames) ctx.addIssue({code:"custom",message:"Pose and duration counts must equal frames"});
  if(plan.airborneFrames?.some(i => i>=plan.frames) || plan.events?.some(e => e.frame>=plan.frames)) ctx.addIssue({code:"custom",message:"Frame index outside plan"});
});
export const actionPlanSchema = storedActionPlanSchema.refine(plan=>plan.frames<=MAX_FRAMES_PER_ACTION,{message:"An action supports a maximum of 4 frames",path:["frames"]});
export function limitActionPlan(input:unknown):ActionPlan {
  const plan=storedActionPlanSchema.parse(input);
  if(plan.frames<=MAX_FRAMES_PER_ACTION)return actionPlanSchema.parse(plan);
  const indices=Array.from({length:MAX_FRAMES_PER_ACTION},(_,i)=>Math.round(i*(plan.frames-1)/(MAX_FRAMES_PER_ACTION-1)));
  return actionPlanSchema.parse({...plan,frames:indices.length,poses:indices.map(i=>plan.poses[i]),durationsMs:indices.map(i=>plan.durationsMs[i]),
    airborneFrames:plan.airborneFrames?.flatMap(i=>indices.includes(i)?[indices.indexOf(i)]:[]),
    events:plan.events?.flatMap(event=>indices.includes(event.frame)?[{...event,frame:indices.indexOf(event.frame)}]:[])});
}
const frameSchema = z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),w:z.number().int().positive(),h:z.number().int().positive(),anchorX:z.number(),anchorY:z.number(),scale:z.number().positive().optional(),durationMs:z.number().int().positive()});
const directionFramesSchema = z.union([
  z.object({mirrorOf:directionSchema,frames:z.never().optional()}),
  z.object({frames:z.array(frameSchema).min(1),mirrorOf:z.never().optional()}),
]);
export const manifestSchema = z.object({
  version:z.literal(1),characterId:z.string().min(1),viewType:viewTypeSchema,
  atlas:z.object({url:z.string().min(1),width:z.number().int().positive(),height:z.number().int().positive(),version:z.number().int().nonnegative()}),pixelScale:z.number().int().positive(),
  actions:z.record(z.string(),z.object({label:z.string(),playback:z.enum(["loop","once","once_hold"]),directions:z.partialRecord(directionSchema,directionFramesSchema),gameplay:gameplaySchema,events:z.array(z.object({frame:z.number().int().nonnegative(),name:z.string()})).optional(),sound:manifestSoundSchema.optional()})),
}).superRefine((manifest,ctx) => {
  for(const action of Object.values(manifest.actions)) {
    for(const [direction,value] of Object.entries(action.directions)) {
      if(value.mirrorOf && (!action.directions[value.mirrorOf]?.frames || value.mirrorOf===direction)) ctx.addIssue({code:"custom",message:"Mirror must reference a concrete direction in the same action"});
      for(const frame of value.frames ?? []) if(frame.x+frame.w>manifest.atlas.width || frame.y+frame.h>manifest.atlas.height) ctx.addIssue({code:"custom",message:"Frame exceeds atlas bounds"});
    }
  }
});
export type Manifest = z.infer<typeof manifestSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
export type ActionGameplay = z.infer<typeof gameplaySchema>;
