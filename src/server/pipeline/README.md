# Sprite pipeline

- `sheet.ts` and `prompts/sheet.ts`: generate and revise three-view sheets, save raw output, and remove backgrounds.
- `presets.ts`: default action plans and gameplay settings.
- `frames.ts`: connected-component/projection extraction plus legacy normalization helpers. Active action processing uses `native-frames.ts` to preserve source pixels and register crop-adjusted pivots.
- `guides.ts` and `prompts/strip.ts`: layout guides and in-place motion prompts.
- `animations.ts`: prepare accepted sheet anchors, generate strips in segments of up to four frames, process frames, and compose an absolute-rectangle atlas and validated manifest.
- `animation-types.ts`: persisted frame, strip, and job schemas.

`server/characters/animations.ts` builds the dependency graph and provides idempotent acceptance and failed-job retries. Strips reference accepted sheet anchors, never the original upload. Raw strip checkpoints avoid repeated successful calls on resume.

Advanced pitch/phase grid snapping and richer visual QA remain follow-up work. See PLAN.md §5 and docs/setup.md for implementation details and limits.

Review sheets, identity crops, and action frames retain native resolution and colors. No logical-height resize or palette reduction runs in the active action path. Native guide slots fill 88% vertically; adaptive batches contain at most four frames. Frame PNGs are trimmed to visible bounds plus one transparent pixel. Manifest frame `scale` compensates for provider canvas differences during rendering without resampling stored pixels. The DPR-aware preview supports fit and 100% source-pixel zoom. Saved legacy strips can be restored locally without an AI call.
