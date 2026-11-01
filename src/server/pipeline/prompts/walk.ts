export const walkPoses = [
  "Full Stride A (Near Leg Back, Far Leg Forward): LEGS: Wide, clear stride. FAR-SIDE leg stepped forward with heel touching the baseline; NEAR-SIDE leg extended behind with toes pushing off the baseline. ARMS: Counter-swing—NEAR-SIDE arm swings forward (~30 degrees), FAR-SIDE arm swings back behind the hip. Elbows softly bent. BODY & HEAD: Low contact phase—head and torso settle 1–2 pixels lower into the stride. Torso leans very slightly forward (1 pixel) with walking momentum. Keep face, eyes and mouth expression locked to Idle.",
  "Passing High-Point A (Near Leg Swinging Forward): LEGS: Dynamic mid-step crossover (NEVER a static idle standing pose). FAR-SIDE leg is straight and planted directly under the hips supporting full body weight. NEAR-SIDE knee bends noticeably and lifts the foot 2–3 pixels off the ground as it swings forward past the standing ankle. ARMS: Mid-swing transition—NEAR-SIDE arm sweeps downward past the hip while FAR-SIDE arm begins swinging forward. BODY & HEAD: High passing apex—head, shoulders, and torso rise 1–2 pixels higher as the body passes over the straight supporting leg. Hair tips and cape/coat hem trail slightly backward. Keep face, eyes and mouth expression locked to Idle.",
  "Full Stride B (Near Leg Forward, Far Leg Back — Opposite of Frame 1): LEGS: Reversed wide stride. NEAR-SIDE leg stepped fully forward with heel planted on the baseline; FAR-SIDE leg extended behind with toes on the baseline (shaded slightly darker for depth). ARMS: Reversed counter-swing—FAR-SIDE arm reaches forward in front of the chest, NEAR-SIDE arm swings back behind the torso. BODY & HEAD: Low contact phase—head and torso dip 1–2 pixels down to match Frame 1's height, absorbing the step impact smoothly. Keep face, eyes and mouth expression locked to Idle.",
  "Passing High-Point B (Far Leg Swinging Forward): LEGS: Dynamic crossover returning to Frame 1 (NEVER a static standing pose). NEAR-SIDE leg is straight and planted directly beneath the hips in the foreground. FAR-SIDE knee bends forward with its foot lifted 2–3 pixels off the ground, partially occluded behind the near leg. ARMS: Mid-swing transition—arms cross smoothly past the torso heading back toward Frame 1's positions. BODY & HEAD: High passing apex—head and torso rise 1–2 pixels higher, matching Frame 2's elevation. Hair, hood, and coat hem show subtle secondary bounce. Keep face, eyes and mouth expression locked to Idle.",
];

export const walkGuidance = `DIRECTION & DEPTH READABILITY (CRITICAL FOR SMOOTH LOOP):
- Clearly distinguish NEAR-SIDE limbs (foreground, closest to viewer) from FAR-SIDE limbs (background, further from viewer).
- Shade the FAR-SIDE leg and FAR-SIDE arm slightly darker (1 shade darker from the existing palette) so the alternating stride reads clearly and never looks like the legs are scissor-snapping in place.
- Preserve outfit asymmetry, character proportions, and natural overlap.
- Keep near/far limb identity fixed throughout. For front/back or overhead cameras, map the two alternating limb pairs consistently to the reference anatomy without rotating the character to force a side view.

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
