import type { Direction, ViewType } from "@/lib/manifest";
import { SHEET_RESOLUTION, DEFAULT_POSE_RESOLUTION } from "@/lib/resolution";
export function sheetPrompt(
  description: string,
  viewType: ViewType,
  key: string,
  hasReference: boolean,
  note = "",
  _logicalHeight = 128 
) {
  // Retain the legacy argument for callers; it no longer controls image detail.
  void _logicalHeight;
  const views =
    viewType === "side_scroller"
      ? "right side profile facing right, front view, back view"
      : viewType === "top_down"
      ? "right-facing side view, down-facing front view, up-facing back view (behind), all from a steep top-down overhead camera"
      : "right-facing three-quarter view, down-facing front three-quarter view, up-facing back three-quarter view (behind), all from a consistent 45-degree elevated camera";

  return `Create a high-detail anime-inspired 16-bit/32-bit pixel-art character turnaround sheet for a 2D video game.

Character description (appearance only): ${description || "the character in the reference image"}.
${
  hasReference
    ? "Preserve the reference character's exact face, hairstyle, clothing, intricate markings, accessories, and colors. Convert to clean high-detail pixel art."
    : "Design one original character matching the description with crisp, readable facial and outfit details."
}

LAYOUT & POSES:
- Target canvas: ${SHEET_RESOLUTION.width}×${SHEET_RESOLUTION.height} pixels, landscape 3:2. Three equal 640-pixel-wide pose slots.
- Camera perspective: ${viewType === "side_scroller" ? "eye-level side view for a side-scrolling game" : viewType === "top_down" ? "steep overhead top-down view; show the tops of the head and shoulders" : "three-quarter view with a 45-degree elevated camera; show both front/side depth and the top surfaces"}. Keep this camera angle consistent across every pose.
- Exactly three full-body neutral standing poses, left to right: ${views}.
- Slot order: Right Side, Front, Behind. Never reorder these views.
- One pose per equal-width invisible slot.
- Same character identity, exact same scale, feet baseline, and proportions in every pose.
- The character should stand tall, filling roughly 88% of the vertical height of the image with clean padding around each pose. No overlap or clipping.

ART STYLE & PIXEL QUALITY (CRITICAL):
- Chibi proportions with crisp, well-defined high-resolution pixel art (native-resolution detail at approximately ${DEFAULT_POSE_RESOLUTION.height} pixels per standing character on the target canvas; never reduce to a 48-, 64-, or 128-pixel logical grid).
- CLEAN PIXEL OUTLINES: Use continuous, crisp 1-pixel dark/black outlines around the character silhouette, hair spikes, face, and clothing details so the sprite is completely enclosed and never has floating/disconnected edge pixels.
- Crisp square pixels, preserve fine color and shading detail without a forced palette limit, clean flat cel shading.
- Define clear facial features (eyes, pupils, expressions), hair strands, and clothing folds. Do NOT make the pixel blocks overly coarse or blocky.
- No sub-pixel antialiasing, soft gradients, text, captions, grid lines, ground lines, scenery, cast shadows, glow, or semi-transparent edge halos.

BACKGROUND KEY: ${key}
- Background must be a 100% flat solid ${key} everywhere outside the character, including enclosed gaps between arms and torso and between legs.
- Reserve this exact hue exclusively for the background. Never use it in clothing, hair, skin, outlines, or accessories.
- Ensure a hard, sharp 100% opaque transition between the character's dark pixel outline and the solid ${key} background (zero color bleeding or fringing).
${note ? `\nRevision requested: ${note}.` : ""}
The layout, outline, and background rules above apply strictly.`;
}

export function revisionSheetPrompt(
  description: string,
  viewType: ViewType,
  key: string,
  note: string,
  path: "edit_latest" | "new_sheet",
  hasReference: boolean,
  logicalHeight = 128
) {
  const base = sheetPrompt(description, viewType, key, hasReference, note, logicalHeight);
  if (path === "edit_latest")
    return `${base}
REVISION MODE: Edit the attached latest generated sheet. It is the authoritative appearance reference and includes prior revisions. Preserve all existing pixel resolution, clean black outlines, details, colors, pose layout, identity, and proportions unless the user's newest note requests a change. Apply the newest revision note consistently in every view. Replace the old backdrop with the reserved background key ${key}, while retaining unaffected character colors.`;

  return `${base}
REVISION MODE: Create a fresh high-detail pixel-art sheet from the original description and newest revision note${
    hasReference ? ", using the original upload as the starting reference" : ""
  }. Discard prior generated sheet designs. Where the newest note changes the original appearance, the note takes precedence. Keep the required view layout, clean dark pixel outlines, and solid background rules.`;
}
// Older overhead/elevated sheets used Front, Behind, Right Side.
export function sheetAnchorOrder(prompt:string,viewType:ViewType):Direction[] {
  return viewType==="side_scroller"||prompt.includes("Slot order: Right Side, Front, Behind.")
    ? ["right","down","up"] : ["down","up","right"];
}
