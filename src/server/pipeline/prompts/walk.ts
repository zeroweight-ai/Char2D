import type { Direction } from "@/lib/manifest";

// Classic 4-frame walk: contact A → passing A → contact B → passing B.
// Each frame is defined both absolutely (near/far leg) and relative to the
// previous frame, because Muse loses leg identity across split strips.
export const walkPoses = [
  "Contact A — NEAR-SIDE LEG IN FRONT: LEGS: Wide, clear stride. The NEAR-SIDE leg is stepped forward (toward the facing direction) with its heel on the baseline; the FAR-SIDE leg is extended behind with its toes pushing off the baseline. ARMS: Counter-swing — FAR-SIDE arm swings forward, NEAR-SIDE arm swings back behind the hip, elbows softly bent. BODY & HEAD: Low contact phase — head and torso 1–2 pixels lower. Torso leans very slightly forward. Keep face, eyes and mouth expression locked to Idle.",
  "Passing A — NEAR-SIDE LEG PLANTED, FAR-SIDE LEG LIFTED: LEGS: The NEAR-SIDE leg (the FRONT leg in frame 1) is now straight and planted directly under the hips, carrying the body weight. The FAR-SIDE leg (the BACK leg in frame 1) bends at the knee and its foot lifts 2–3 pixels off the ground as it swings forward past the planted ankle, partly hidden behind the near leg. Do NOT lift the near-side leg in this frame. ARMS: Both arms pass close to the torso, mid-swing. BODY & HEAD: High passing apex — head and torso 1–2 pixels higher. Keep face, eyes and mouth expression locked to Idle.",
  "Contact B — FAR-SIDE LEG IN FRONT (exact leg swap of frame 1): LEGS: Mirror the leg positions of frame 1 with the legs exchanged. The FAR-SIDE leg is now stepped forward with its heel on the baseline; the NEAR-SIDE leg is extended BEHIND with its toes pushing off. The leg that was in front in frame 1 is now behind, and the leg that was behind is now in front — this frame must NOT look like frame 1. ARMS: Reversed counter-swing — NEAR-SIDE arm swings forward, FAR-SIDE arm swings back. BODY & HEAD: Low contact phase — head and torso settle to the same height as frame 1. Keep face, eyes and mouth expression locked to Idle.",
  "Passing B — FAR-SIDE LEG PLANTED, NEAR-SIDE LEG LIFTED: LEGS: The FAR-SIDE leg (the FRONT leg in frame 3) is now straight and planted directly under the hips. The NEAR-SIDE leg (the BACK leg in frame 3) bends at the knee and its foot lifts 2–3 pixels off the ground as it swings forward past the planted ankle, in the foreground. Do NOT lift the far-side leg in this frame. This pose leads straight back into frame 1. ARMS: Both arms pass close to the torso, mid-swing. BODY & HEAD: High passing apex, same height as frame 2. Keep face, eyes and mouth expression locked to Idle.",
];

/** Names the near/far limbs anatomically for side-facing strips. */
function limbKey(direction: Direction | undefined) {
  if (direction === "right") return "- LIMB KEY (facing right): NEAR-SIDE = the character’s RIGHT leg and RIGHT arm (closest to the camera, drawn on top). FAR-SIDE = the character’s LEFT leg and LEFT arm (partly hidden behind the body). Use the outfit from the FIRST reference to tell them apart (e.g. a stocking, boot or sleeve that differs between the two sides) and keep each leg’s design attached to the same leg in every frame.";
  if (direction === "left") return "- LIMB KEY (facing left): NEAR-SIDE = the character’s LEFT leg and LEFT arm (closest to the camera, drawn on top). FAR-SIDE = the character’s RIGHT leg and RIGHT arm (partly hidden behind the body). Use the outfit from the FIRST reference to tell them apart and keep each leg’s design attached to the same leg in every frame.";
  return "- For front/back or overhead cameras, map NEAR/FAR to the character’s two legs consistently and keep each leg’s design attached to the same leg in every frame, without rotating the character to force a side view.";
}

export function walkGuidance(direction?: Direction) {
  return `DIRECTION & DEPTH READABILITY (CRITICAL FOR SMOOTH LOOP):
- Clearly distinguish NEAR-SIDE limbs (foreground, closest to viewer) from FAR-SIDE limbs (background, further from viewer).
${limbKey(direction)}
- Shade the FAR-SIDE leg and FAR-SIDE arm slightly darker (1 shade darker from the existing palette) so the alternating stride reads clearly and never looks like the legs are scissor-snapping in place.
- Preserve outfit asymmetry, character proportions, and natural overlap.

LEG ORDER (CRITICAL):
- Frames 1 and 3 are OPPOSITE contact poses: whichever leg is in front in frame 1 is behind in frame 3. Never draw frame 3 with the same leg in front as frame 1.
- In each passing frame (2 and 4), the leg that was in FRONT in the previous contact frame is the planted standing leg, and the leg that was BEHIND lifts and swings forward. Never lift the leg that was already in front.

BASIC ACTION — NO WEAPON USE:
- Peaceful locomotion only—never a combat or attack stance.
- Do not swing, aim, thrust, or activate any weapon.
- Keep stowed/sheathed weapons fixed in their reference location.
- If a weapon/staff is held in hand in the reference, carry it passively at a consistent low angle, letting that arm sway gently with the walk rhythm without brandishing it. This passive grip takes priority over the generic arm counter-swing.

FLUIDITY & CONTINUITY RULES:
- SEAMLESS 4-FRAME LOOP: Frame 1 -> 2 -> 3 -> 4 must loop effortlessly back into Frame 1 with constant forward momentum and zero pause.
- ANTI-STUTTER RULE: Frame 2 and Frame 4 MUST look like active mid-stride passing poses (one knee bent and foot clearly lifted off the ground, body elevated 1–2px), never like two copied Idle frames.
- NATURAL HEAD BOB: Maintain a gentle 1–2 pixel vertical sine-wave bounce (Down on Frames 1 & 3, Up on Frames 2 & 4) while keeping the face, eyes, and head structure 100% locked in detail.
- SECONDARY MOTION: Allow subtle 1–2 pixel sway in the cape, coat hem, or hair tips reacting to the up-and-down stride. Animate only features present in the reference.
- ANIMATE IN PLACE: Keep the horizontal center of mass centered in each slot. Planted feet rest firmly on the exact same baseline without vertical floating or horizontal drifting.`;
}
