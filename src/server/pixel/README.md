# Deterministic pixel processing

`chroma.ts` contains original Char2D implementations of upload/prompt-based key selection, palette sampling, chroma removal, edge unmixing, and output checks.

`../pipeline/frames.ts` implements connected-component/projection extraction, shared median-cut palettes, nearest-neighbor logical normalization, outlines, and feet registration for anchors and animation frames.

Advanced grid-pitch/phase detection and richer QA remain follow-up work. See PLAN.md §5 and §12; preserve attribution when adapting sprite-gen algorithms.
