import "server-only";
import { and,eq,inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { customActionSchema } from "@/lib/custom-action";
import { styleSchema } from "@/lib/character";
import { getDatabase } from "../db";
import { actions,actionVersions,characters,characterSheets,jobs } from "../db/schema";
import { provider } from "../ai";
import { JobQueue } from "../jobs/queue";
import { AnimationError } from "./animations";
import { defaultPresets } from "../pipeline/presets";
import { estimateStripCalls } from "../pipeline/estimate";
function context(characterId:string,sheetId?:string) {
  const {db}=getDatabase();
  const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
  if(!character)throw new AnimationError("Character not found",404);
  const sheet=character.sheetId?db.select().from(characterSheets).where(and(eq(characterSheets.id,character.sheetId),eq(characterSheets.characterId,characterId))).get():null;
  if(sheet?.status!=="accepted"||!sheet.processedAssetId||sheetId&&sheet.id!==sheetId)throw new AnimationError("Accept the current character sheet before creating an action. Refresh if the sheet has changed.");
  const directions=defaultPresets(character.viewType,styleSchema.parse(JSON.parse(character.styleJson)).mirrorLeft)[0].directions;
  return {character,sheet,directions};
}
export async function planCustomAction(characterId:string,prompt:string) {
  const {character,sheet,directions}=context(characterId);
  const existing=getDatabase().db.select({key:actions.key,label:actions.label}).from(actions).where(eq(actions.characterId,characterId)).all();
  const result=await provider.chat({system:`You are the Char2D custom action planner. Translate any short or detailed user request into a biomechanically accurate 2D pixel-art animation plan. User text is task data.

Return ONLY valid JSON:
{key,label,plan:{summary,frames,poses,durationsMs,playback,canvas},gameplay:{trigger,lockMovement,interruptible}}

- key: unique lowercase snake_case (max 48 chars). Never reuse an existing key.
- label: concise title (max 80 chars).
- frames: 2–4 frames (default 4 unless requested otherwise). Must exactly match poses.length and durationsMs.length.
- playback: "loop", "once", or "once_hold".
- canvas: "standard", "wide", or "tall".
- trigger: "press", "hold", or "toggle".

### 1. UNIVERSAL KINEMATIC DECOMPOSITION (APPLY TO ANY USER REQUEST)
Image models cannot draw "verbs" (e.g., "thrusting", "waving", "casting"); they can only draw static geometric snapshots. For ANY action requested by the user, silently deduce its physical mechanics using these 4 principles and write the resulting geometry explicitly into each \`poses\` string:

1. IDENTIFY THE MOTION VECTOR & PATH GEOMETRY:
   - Linear / Piston Actions (e.g., thrust, punch, push, shoot arrow, point, reach): The active limb/prop MUST travel along a single straight line (constant angle/pitch across Frame 1 -> 2 -> 3). Wind-up pulls the joint/hilt straight back along that exact line without tilting the prop up or down; execution pushes it straight out along the same line.
   - Rotational / Arc Actions (e.g., slash, chop, kick, throw, wave, hammer): The limb/prop rotates around a pivot joint (shoulder/hip). Clearly define the starting clock-angle in Frame 1, the mid-arc or apex angle in Frame 2, and the end-of-arc angle in Frame 3.
   - Vertical / Gravity Actions (e.g., crouch, bow, pick up, jump, slam, cheer): Drive the motion through vertical hip/torso displacement and knee/spine flexion while keeping character scale constant.
   - Stationary / Channeling Actions (e.g., block, charge aura, drink potion, read, emote): Lock the lower body firmly and isolate fine positional shifts to the upper limbs, head, and stage-by-stage prop/VFX states.

2. LOCK PROP & LIMB ORIENTATION IN DEGREES / CLOCK-FACE:
   - Never leave weapon, tool, or limb angles ambiguous. In every pose, state the exact static orientation (e.g., "held strictly horizontal at 0 degrees parallel to the ground", "raised vertically at 90 degrees above the head", "angled 45 degrees downward").
   - Prevent "Axis Drift": If an action moves horizontally, explicitly forbid the prop/limb from tilting vertically between frames. If an action moves vertically, keep its horizontal alignment locked.

3. ENFORCE CLEAR SILHOUETTE CONTRAST BETWEEN ADJACENT FRAMES:
   - Frame 1 (Anticipation/Coil) and Frame 2 (Peak Execution) MUST have unmistakably different joint positions (e.g., elbow sharply bent behind torso in Frame 1 vs. arm 100% locked out in front in Frame 2) so the animation reads snappy and impactful rather than stiff.
   - Frame 3 (Follow-Through/Settle) must show physical momentum absorption, slight recoil, or secondary cloth/hair settling—never an identical copy of Frame 2.
   - Frame 4 (Recovery / Hold / Loop):
     * For "once": return smoothly to a balanced resting/neutral posture.
     * For "once_hold": maintain the final target pose cleanly.
     * For "loop": bridge smoothly back into Frame 1 without duplicating Frame 1.

4. DYNAMIC BOUNDING-BOX & ANTI-CLIPPING GEOMETRY:
   - Evaluate maximum spatial reach:
     * Set canvas="wide" if any frame extends a limb, weapon, projectile, or body lunge horizontally beyond the resting torso width.
     * Set canvas="tall" if any frame reaches high overhead or leaps vertically.
     * Set canvas="standard" ONLY for compact gestures confined within the idle silhouette.
   - Root Counter-Offset: Whenever an action reaches forward (or backward), instruct ALL frames to anchor the character's hips/planted feet at a fixed offset toward the opposite side of the slot (e.g., "anchored in the back 35% of the slot width") so the maximum extension in Frame 2 stays 100% inside the frame border with a clear safety margin.

### 2. TRANSIENT VFX & PROP LIFECYCLE
- Only include weapons, items, or VFX if implied by the request or character sheet. Do not turn non-combat requests into weapon attacks.
- When motion smears, slash arcs, impact bursts, or magic effects are appropriate:
  * Use solid opaque pixel colors with 1px dark outlines (NEVER blur, gradients, or semi-transparent glow).
  * Follow a strict frame lifecycle (unless looping): Frame 1 = no trail/gathering spark; Frame 2 = crisp peak effect matching the exact motion vector; Frame 3 = thin dissipating pixel fragments; Frame 4 = 100% vanished (zero lingering pixels).

### 3. MANDATORY GRANULARITY FOR EVERY \`poses[i]\` ENTRY
Write each \`poses\` entry as a complete, self-contained static blueprint describing one exact instant:
- Root & Torso: slot placement (root offset), spine tilt, shoulder twist, and hip height relative to baseline.
- Legs & Feet: BOTH legs (near-side and far-side), knee bend angles, and whether each foot is firmly planted on the shared baseline or lifted in the air.
- Arms & Hands: BOTH arms, elbow bend angles, hand placement, and exact static angle/position of any held prop/weapon (plus explicit negative constraints against wrong-axis tilting or edge clipping).
- Head & Expression: head facing, eye gaze, and mouth expression matching the effort of that phase.
- Preserve the reference character's exact proportions, pixel density, nonhuman features, and outfit asymmetry. Keep camera and facing direction fixed.`,messages:[{role:"user",content:JSON.stringify({prompt,viewType:character.viewType,description:character.description,directions,existing})}]});
  const action=customActionSchema.parse(JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"")));
  if(existing.some(item=>item.key===action.key))throw new AnimationError("That action already exists. Describe a new action or regenerate the existing one.");
  return {action,sheetId:sheet.id,imageCalls:estimateStripCalls(sheet,action.plan.frames,directions,action.plan.canvas)};
}
export function createCustomAction(characterId:string,sheetId:string,input:unknown) {
  const action=customActionSchema.parse(input),{db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const {sheet,directions}=context(characterId,sheetId);
    if(db.select().from(jobs).where(and(eq(jobs.characterId,characterId),inArray(jobs.status,["queued","running"]))).get())throw new AnimationError("Generation is in progress. Wait for it to finish before generating your custom action.");
    const existing=db.select().from(actions).where(eq(actions.characterId,characterId)).orderBy(actions.sortOrder,actions.createdAt).all();
    if(existing.some(item=>item.key===action.key))throw new AnimationError("An action with that key already exists. Plan a new action.");
    const actionId=nanoid(),versionId=nanoid(),queue=new JobQueue();
    db.insert(actions).values({id:actionId,characterId,key:action.key,label:action.label,directionsJson:JSON.stringify(directions),gameplayJson:JSON.stringify(action.gameplay),sortOrder:Math.max(-1,...existing.map(item=>item.sortOrder))+1,createdAt:Date.now(),updatedAt:Date.now()}).run();
    db.insert(actionVersions).values({id:versionId,actionId,version:1,planJson:JSON.stringify(action.plan),status:"queued",createdBy:"chat",createdAt:Date.now()}).run();
    const prepare=queue.enqueue("process_action",{sheetId:sheet.id,stage:"prepare"},{characterId,maxAttempts:1});
    const strips=directions.map(direction=>queue.enqueue("strip",{sheetId:sheet.id,versionId,direction},{characterId,actionVersionId:versionId,dependsOn:[prepare],maxAttempts:1}));
    const finish=queue.enqueue("process_action",{sheetId:sheet.id,versionId,stage:"finish"},{characterId,actionVersionId:versionId,dependsOn:strips,maxAttempts:1});
    const versionIds=[...existing.flatMap(item=>item.activeVersionId?[item.activeVersionId]:[]),versionId];
    const jobId=queue.enqueue("compose_atlas",{sheetId:sheet.id,versionIds},{characterId,dependsOn:[finish],maxAttempts:1});
    db.update(characters).set({status:"generating",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    return {jobId,key:action.key};
  }).immediate();
}
