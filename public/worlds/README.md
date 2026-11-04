# World assets

`market-adventure.png` is the user-provided “Vibrant Pixel-Art Market Adventure.png” map, copied unchanged from `data/assets/map` so the Playground can serve it as a static asset. It replaces the previous village-platformer backdrop. The Playground overlays the selected character’s atlas on the village path.

Terrain collision coordinates live in `src/lib/game/world.ts`, in the image's native 1672 × 941 coordinate space. Keep those shapes aligned with the roads, logs, grass tops, chicken-ledge barrel/crates and spikes when changing the map image. Other props are scenery.

The same file defines the pink ladder's climb zone between the chicken ledge and house ledge.

The backdrop contains no gold coins or treasure chests. Their interactive definitions live in `world.ts`, and `render-items.ts` draws the five coins and two chests on a separate canvas. Collected coins and broken chests disappear naturally to reveal the original scenery.

`goblin-soldier/walk.png` is the transparent four-frame, left-facing walk atlas generated with Muse from “Pixel Goblin Brute with Spiked Mace.png”. `goblin-soldier/walk.json` stores its frame bounds, foot anchors, timing and source. The soldier appears after collecting every map and chest coin. Regeneration/reprocessing is handled by `scripts/generate-goblin-walk.ts`; raw output and request provenance are preserved under `data/goblin-soldier`.
