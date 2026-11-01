import { walkGuidance, walkPoses } from "./walk";
import { SHEET_RESOLUTION } from "@/lib/resolution";
import { MAX_FRAMES_PER_STRIP } from "../presets";
import type { Direction, ViewType } from "@/lib/manifest";

export function stripPrompt(input: {
  viewType?: ViewType;
  canvas?: "standard" | "wide" | "tall";
  label: string;
  actionKey?:string;
  idleReference?:boolean;
  actionReference?:boolean;
  direction: Direction;
  poses: string[];
  key: string;
  segment: number;
  total: number;
  logicalHeight?: number;
  referenceWidth?:number;
  referenceHeight?:number;
  startFrame?:number;
  playback?: "loop" | "once" | "once_hold";
}) {
  if (input.poses.length < 1 || input.poses.length > MAX_FRAMES_PER_STRIP)
    throw new Error("Generate one to four frames per strip");

  const resolution = input.referenceHeight ? `${input.referenceWidth}×${input.referenceHeight} native pixels` : "the reference image’s native pixel dimensions";

  const isWalk=(input.actionKey??input.label.trim().toLowerCase())==="walk";
  const isCustom=!["idle","walk","jump","crouch"].includes(input.actionKey??input.label.trim().toLowerCase());
  const start=input.startFrame??input.segment*MAX_FRAMES_PER_STRIP+1;
  return `Char2D high-detail pixel-art animation strip. Frame count: ${input.poses.length}
Create a SINGLE HORIZONTAL strip of exactly ${input.poses.length} full-body pixel-art frames, facing ${input.direction}, performing ${isWalk ? "a smooth, continuous Walk cycle" : input.label}.

CANVAS: ${input.canvas??"standard"}. ${input.canvas==="wide"?"Each slot is 1.65x standard width. Follow the offset body box in the SECOND reference; retain native character size and use the extra space for weapon reach and effects.":input.canvas==="tall"?"Each slot is 1.6x standard height. Follow the lowered body box in the SECOND reference and reserve the space overhead for the action. Preserve native character size; do not enlarge to fill the taller slot.":"Follow the reference body size."}

CAMERA: ${input.viewType === "top_down" ? "Steep overhead top-down view" : input.viewType === "three_quarter" ? "Three-quarter view from a 45-degree elevated camera" : "Eye-level side view"}. Preserve the FIRST reference’s camera angle and perspective throughout the action.

1:1 REFERENCE LOCK (CRITICAL):
- The FIRST reference is the accepted character sheet's direction anchor. You are animating THIS EXACT SPRITE—do NOT downscale, simplify, or redraw it in lower resolution.
- RESOLUTION STANDARD: Match the native detail of a ${SHEET_RESOLUTION.width}×${SHEET_RESOLUTION.height} character sheet. Strip canvas width depends on frame count; each character retains the accepted sheet pose’s native height.
- EXACT SCALE & PIXEL DENSITY: Every frame must match the FIRST reference's exact character height (${isCustom||input.canvas==="tall"?"match the guide body box; never scale up to fill the slot":"85–90% of slot height"}; FIRST reference: ${resolution}) and fine pixel density.
- PRESERVE DETAILS & OUTLINES: Copy the face, eye details, hair spikes, outfit markings, colors, proportions, and crisp 1-pixel dark/black outlines directly from the FIRST reference. Static parts like the head and face should remain virtually identical to the reference, only shifting position/angle for the motion.
- The SECOND reference is a slot layout guide: place one full-sized pose per slot. Do not draw the guide lines.
${input.segment ? "- The THIRD reference shows the last frame of the preceding strip. Continue the motion smoothly from it.\n" : ""}
${!isWalk&&["idle","walk","jump","crouch"].includes(input.actionKey??input.label.trim().toLowerCase()) ? `BASIC ACTION — NO WEAPON USE (CRITICAL):
- This is a peaceful locomotion/rest pose, never a combat or attack animation. Do not draw, aim, swing, thrust, fire, brandish or activate a weapon; no attack stance, muzzle flash, projectile or weapon effects.
- Keep existing weapons safely sheathed, holstered or stowed in their reference location. Do not invent equipment. If a weapon is already carried in hand, keep it lowered and passive with the same grip; weapon safety takes priority over generic open-hand or arm-swing instructions. Adapt that arm naturally without using the weapon.
- Idle establishes the relaxed stance, grip, equipment placement and neutral expression used by the other basic actions.
` : ""}${isWalk ? walkGuidance+"\n" : ""}${input.idleReference&&isWalk ? `IDLE FOUNDATION (CRITICAL):
- The FIRST reference defines exact character identity, pixel resolution, scale, colors, and 1px dark outlines.
- The LAST reference is the generated Idle frame for this facing direction. Preserve its exact head design, facial expression, proportion, and passive item grip, modifying only limb positions, vertical body bounce, and cloth sway for walking.
- Do not add an Idle slot: all four frames must be active walking poses.
` : input.idleReference&&isCustom ? `BASIC-ACTION SIZE FOUNDATION (CRITICAL):
- The LAST reference is the accepted Idle frame for this direction, already expressed at the basic action's logical display scale. Match its head size, torso width, limb thickness and resting body proportions in EVERY custom frame. The FIRST reference locks identity; Idle and the SECOND reference body box lock size.
- Extra wide/tall canvas space is ONLY for movement, full-length equipment and effects. Never grow the character to fill it. Crouching changes joint angles, not anatomical scale. Raised weapons and effects may extend beyond the body box while staying inside the slot.
- Derive the requested action from Idle, changing only the joints, grip and expression required by the plan. Weapon use and requested VFX are allowed. Do not insert an extra Idle slot.
` : input.idleReference ? `IDLE FOUNDATION (CRITICAL):
- The LAST reference is the generated Idle frame for this exact facing direction. Derive this action from that Idle: preserve its resting anatomy, face, grip, equipment placement and passive weapon state while changing only the joints needed for the listed motion.
- The FIRST reference remains the authority for identity, native detail and scale. Idle is the pose/continuity foundation. Begin the motion naturally from Idle; do not add an extra Idle slot or replace a required action phase.
- Keep weapons stowed or passively lowered exactly as in Idle throughout the action. Return toward Idle for looping locomotion; preserve the specified airborne or crouched final pose for held actions.
` : ""}
${isCustom ? `CUSTOM ACTION — FRAME-BY-FRAME CONSTRUCTION (CRITICAL):
- SIZE LOCK: Use identical head size, torso width, limb thickness and native pixel density in EVERY action frame. A wider silhouette from an arm or weapon does not mean a larger character. Never enlarge later frames, zoom into the active swing or fit each pose independently to its slot.
- WEAPON LENGTH LOCK: Preserve the reference weapon's complete hilt, guard and blade, including its blade-to-body length ratio, tip shape and thickness. Do not shorten, retract, bend or replace the weapon to fit the frame. For a horizontal slash keep the full blade visibly extended in the swing plane; do not foreshorten it into a stub.
${input.actionReference ? `- ${input.idleReference?"The reference immediately before LAST":"The LAST reference"} is frame 1 of THIS action. Preserve its body and weapon proportions across strips, while matching the Idle size reference when provided. It is a continuity reference, not an instruction to repeat its pose.\n` : ""}
- Use the same camera, native sprite scale, pixel density, palette, anatomy, facing and ground baseline as the basic actions. The action changes the pose, not the character design.
- Construct each numbered slot independently from the FIRST reference, then apply only that frame's listed pose. Read the poses in order as distinct instants of one coherent action; do not blend several phases into one frame or substitute a generic action pose.
- In EVERY frame, preserve the exact hair silhouette, face and visible eye/mouth details, outfit seams and markings, accessories, equipment, colors and 1-pixel outlines. Maintain anatomical left/right and near/far occlusion. Move clothing and attached equipment with the body parts that carry them.
- Resolve the torso/hip angle and support, both knees and feet with planted/lifted contact, both shoulders/elbows/hands and grip, and head/expression for EACH listed instant. Show only anatomy visible from the fixed camera; never invent hidden facial details or extra limbs.
- Keep equipment in its reference location and grip unless the listed action explicitly requires using or moving it. Preserve its design and attachment throughout anticipation, performance and recovery.

DIRECTION & ANTI-CLIPPING RULE (CRITICAL):
- Keep the character facing ${input.direction} in every frame. NO EDGE CLIPPING OR WEAPON CUTOFF: the entire character, fully extended weapon tip and complete effect arc must remain inside each slot with a clear safety margin.
- For a forward swing, place the body slightly toward ${input.direction === "right" ? "the left-center" : input.direction === "left" ? "the right-center" : input.direction === "up" ? "the lower-center" : "the upper-center"} of each slot to reserve space in the facing direction. Use the same root offset throughout the action; do not drift between frames.

WEAPON & REQUESTED TRAIL VFX:
- Render only effects specified by the action plan. Use solid, opaque, crisp pixel-art colors with 1px dark outlines; no soft gradients, semi-transparent alpha glow or blur that could bleed into the chroma-key background.
- For a four-frame slash with a trail: Frame 1 wind-up has NO trail; Frame 2 active swing has the full crescent trail immediately behind the blade; Frame 3 follow-through has only a few thin dissipating pixel streaks/fragments; Frame 4 clean recovery has ZERO lingering particles, streaks or effects. Apply this timing only when the requested action calls for a slash trail; otherwise follow the listed poses.

SLOT BOUNDS — PREVENT OUT-OF-BOUNDS CROPPING (CRITICAL):
- Divide the entire output canvas into exactly ${input.poses.length} equal-width slots. Each slot spans the full canvas height. Its left/right edges are hard crop boundaries; the faint rectangles in the guide indicate reference body size, not extra space available beyond a slot.
- Before rendering, measure the combined envelope of ALL listed poses: body, backward wind-up, forward reach, sword tip, overhead reach, cloth, tail and every VFX fragment. Choose one shared root position that fits this complete motion envelope inside every slot, not just the resting body.
- Reserve at least 5% of slot width at BOTH horizontal edges and 5% of slot height at BOTH vertical edges as completely empty background. All outlines, weapon tips and VFX must remain inside this inset safe area. Apply these margins to each slot individually, including the first and last slots.
- Treat each slot in the SECOND reference as a hard frame boundary. Keep the COMPLETE silhouette inside its own slot: hair tips, ears, hands, fingers, feet, clothing, tails and all carried equipment, including the full reach of raised arms, extended weapons and requested VFX.
- Leave a visible band of background on all four sides of each silhouette, including above the highest extremity and below the lowest foot. Neither the outer canvas edge nor an internal slot boundary may touch or cut a character pixel.
- Check the widest and tallest listed poses before drawing frame 1. Keep one consistent native anatomical scale and root alignment across every frame; never zoom, shrink, stretch or shift individual frames to hide overflow.
- Fit wide or raised gestures using the extra canvas space and natural joint bends while preserving the listed action, full visible weapon length and limb proportions. Never truncate an extremity, omit equipment, cross into a neighboring slot or let a pose continue outside the canvas.
- A fully extended weapon means the WHOLE weapon is visible, not that the arm must be straight toward the border. Bend the elbow or adjust the swing position within the extra canvas space; keep the complete visible blade length, fixed camera and facing. Keep trails compact around the blade path rather than expanding them toward the edges.
- If a pose or trail would breach the safe area, recompose its joint angles and trail extent BEFORE rendering. Never solve overflow by cropping, hiding a tip behind the frame edge, deleting a body part, reducing native pixel detail or changing scale between frames. Safe-area containment takes priority over exaggerated reach and effect size.
- Before output, inspect every slot separately for complete anatomy, reference detail, correct pose and clear edge margins.
` : ""}
These are frames ${start}–${start+input.poses.length-1} of ${input.total}.

DIRECTION & BODY MECHANICS (ALL ACTIONS):
- Facing ${input.direction} means ${input.direction === "right" ? "nose, chest and toes oriented toward screen-right" : input.direction === "left" ? "nose, chest and toes oriented toward screen-left" : input.direction === "up" ? "facing away from the viewer toward the top of the screen; show the back of the head, never a front-facing face" : "facing toward the viewer toward the bottom of the screen"}. Keep this heading in every frame; no turning, camera rotation or accidental mirroring.
- Forward/backward motion is relative to that heading. Left/right limbs always mean anatomical sides. Preserve limb identity, outfit asymmetry and natural near/far occlusion; never invent extra limbs or expose hidden facial features.
- For EVERY listed frame, resolve torso/hips and weight, each leg/knee, each foot and its ground contact, both arms/elbows/hands, and head/visible eyes/mouth. Preserve the reference anatomy; adapt these instructions to its actual limbs and facial features.
- Feet marked planted stay on the shared ground baseline with no sliding; lifted feet visibly clear it. Bend joints naturally and preserve limb lengths. Lower a crouching body by bending knees, never by scaling the sprite.
- Keep head and facial identity stable; expression changes only when specified. Render hidden limbs with correct occlusion, never by changing facing.
- Exactly one pose per slot, in the listed order: no omitted, duplicated, merged or extra frames and no in-between poses inside a slot.
- ${input.playback === "loop" ? "This action loops: the last pose must connect naturally to the first, without an extra duplicate endpoint." : input.playback === "once_hold" ? "Play once, then hold the final listed pose; do not add a recovery or return-to-standing frame." : input.playback === "once" ? "Play once in the listed order; include recovery only when specified by the plan." : "Follow the listed motion phases and their final pose; keep transitions smooth."}

Poses, left to right (slot number / action frame):
${(isWalk&&input.total===4 ? walkPoses.slice(start-1,start-1+input.poses.length) : input.poses).map((pose, i) => `${i + 1}. Action frame ${start+i} of ${input.total}: ${pose}`).join("\n")}

ANIMATION & TECHNICAL RULES:
- Animate IN PLACE: do not travel horizontally across the strip.
- Same anatomical scale and ground baseline in all frames. Crouching reduces pose height through joint bending. Jump poses stay centered at the root: the engine handles jump height; do not draw a rising/falling travel arc across slots.
- Keep a small safety gap around each pose; poses must not overlap, touch, or be clipped.
- Crisp square pixels, clean dark pixel outlines, flat cel shading, the reference’s complete original colors; no palette reduction or posterization. No antialiasing, gradients, motion blur, ground lines, cast shadows, captions${isCustom ? ", or unrequested effects. Requested VFX must use opaque flat pixels and stay inside their slot" : ", or effects"}.
- Background key: ${input.key}
- Use a 100% flat solid ${input.key} outside every character and in all enclosed gaps, with a sharp opaque edge against the character's dark outline. Never use ${input.key} on the character. Output only the sprite strip.`;
}
