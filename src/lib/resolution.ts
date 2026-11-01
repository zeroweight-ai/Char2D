// Canvas target from the approved 1920×1280 example sheet.
// Muse treats size as a request; preserve returned native pixels instead of upscaling.
export const SHEET_RESOLUTION = { width: 1920, height: 1280 } as const;
export const POSE_HEIGHT_RATIO = 0.88;
export const DEFAULT_POSE_RESOLUTION = { width: 563, height: Math.round(SHEET_RESOLUTION.height * POSE_HEIGHT_RATIO) };
