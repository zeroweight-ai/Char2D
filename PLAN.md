# Char2D: Technical Plan

> **Char2D — Pixel Character Maker.** Upload one image and get an anime-inspired pixel-art game character. Animate it through chat, map its actions to buttons, and play it in a sample world.
>
> Audience: the implementing developers. Status: design v1 (2026-10-28).
> Open source: clone the repo, add a Muse API key, run `npm run dev`, and it works.

---

## 0. TL;DR

| Topic | Decision |
|---|---|
| App | Single **Next.js 15 (App Router) + React 19 + TypeScript** app. No separate backend service. |
| DB | **SQLite** in `./data/char2d.db` through **Drizzle ORM + better-sqlite3**. Migrations run automatically on boot. |
| Files | Local filesystem under `./data/assets/…`, served by a Next route handler. |
| AI | **Muse API** (Meta) for both the **chat/planner LLM** and **image generation**, behind a provider interface (`src/server/ai/`). |
| Sprite pipeline | **Atlas approach.** (1) Generate a **character sheet** from the user's image. (2) For every action, generate **one horizontal strip** of frames in one image call, with the sheet as reference. (3) If an action needs more frames than fit in one strip, generate **additional strips** conditioned on the previous strip. (4) Deterministic post-processing (chroma key → frame split → pixel snap → shared palette → align) runs in TS and composes **one atlas PNG + `manifest.json`** per character. |
| Prior art | Algorithms ported/adapted from `../sprite-gen` (Apache-2.0): row prompts, layout guides, chroma unmixing, component-based extraction, "pixel-unfake" grid snap, shared palette. We keep its NOTICE attribution. |
| Jobs | SQLite-backed job queue plus an in-repo **worker process**, started together with Next by `npm run dev`. Progress reaches the UI over **SSE**. |
| Game runtime | **Phaser 3** for the Playground (two sample worlds). A lightweight canvas `<SpritePlayer>` handles the Character Maker preview. Both read the same manifest. |
| View types | `side_scroller` (Mario-like: left, right, jump, crouch) and `top_down` (the "geometric"/overhead RPG view: up, down, left, right). The view type is chosen at creation, and worlds that don't match it are disabled. |

---

## 1. Product scope

### 1.1 Features (v1)
1. **Create a character from one image.** Upload a photo, drawing, or anime image. Pick a **view type**, and optionally add a name and a short description. The app generates a pixel-art **character sheet**, then the **default actions** for that view type.
2. **Character Maker page.** The character stands animated in the centre of a stage. Clicking an action chip (or pressing its bound key) plays that action. Controls: play/pause, speed, frame scrubber, onion skin, flip, background (checker, grass, dark).
3. **Chat bar** at the bottom. The user writes a free-form request ("make the jump floatier", "add a spinning sword attack on J", "dash forward fast"). The agent decides whether this means **adjusting an existing action** or **creating a new one**. It plans the action (poses per frame, timing, canvas, loop mode) and calls image generation. Results stream into the stage.
4. **Button mapping.** Every action can be bound to keyboard keys or gamepad buttons, with a trigger mode (press/hold/toggle). Defaults are set per view type, and conflicting bindings are detected.
5. **Playground** with two sample worlds:
   - **Side-scroller world**: platforms, gravity, a scrolling camera.
   - **Top-down world**: a 4-direction overhead map with y-sorting.

   The world that doesn't match the selected character's view type is **disabled** (greyed out, with a tooltip). Several characters can be added at once: local P1/P2 on separate key profiles, plus extra characters as idle "NPCs" that you can switch control to.
6. **Export** (low cost, high value for an open-source tool): download the atlas PNG, `manifest.json`, a Phaser atlas JSON, and a GIF for each action.

### 1.2 Non-goals for v1
- Accounts and multi-user hosting (the app runs locally, single user).
- True 8-direction isometric. This is a stretch goal; the data model already supports arbitrary directions.
- Pixel editing tools beyond "regenerate" and "retime".
- Mobile authoring. The Playground should work with touch controls, but the Maker targets desktop.

### 1.3 Default actions by view type

`R` = generated facing right. **Left is a horizontal mirror of right by default**, which halves cost. The character can opt into `mirrorLeft: false` if it has asymmetric details (a sword hand, a hair clip), and then the left strips are generated separately.

| View type | Action id | Directions | Frames | FPS | Playback | Notes |
|---|---|---|---|---|---|---|
| side_scroller | `idle` | R (+mirror) | 4 | 6 | loop | subtle breathing + blink |
| side_scroller | `walk` | R (+mirror) | 6 | 10 | loop | covers "move left/right" |
| side_scroller | `jump` | R (+mirror) | 4 | 10 | once → hold last | crouch, takeoff, airborne, fall pose. The engine owns the height. |
| side_scroller | `crouch` | R (+mirror) | 2 | 8 | once → hold last | down into crouch, then hold |
| top_down | `idle` | down, up, R (+mirror) | 2–4 | 6 | loop | |
| top_down | `walk` | down, up, R (+mirror) | 4–6 | 10 | loop | covers move up/down/left/right |

The defaults generate **4 strips** for side_scroller and **6 strips** for top_down, plus 1 sheet. All animation is **in place**: the character never travels inside a strip. Displacement (movement, jump height, dash distance) belongs to the game engine and is configured per action (§6.4). This is critical, because it keeps frames aligned and lets the AI tune "higher/faster" without regenerating images.

---

## 2. System architecture

```
┌────────────────────────── Next.js app (one repo, one `npm run dev`) ──────────────────────────┐
│                                                                                                │
│  Browser                                                                                       │
│  ├─ /                      Home / character gallery                                            │
│  ├─ /create                Upload + view-type wizard                                           │
│  ├─ /characters/[id]       Character Maker (stage, action bar, chat bar, bindings)             │
│  └─ /playground            Phaser worlds (side_scroller | top_down)                            │
│        ▲  REST (route handlers) + SSE (/api/events)                                            │
│        │                                                                                       │
│  Server (Node runtime route handlers)                                                          │
│  ├─ src/server/db          Drizzle schema, migrations, repositories                            │
│  ├─ src/server/ai          MuseClient, LLM agent (tools), image provider interface             │
│  ├─ src/server/pipeline    sheet → strips → extract → pixel snap → palette → atlas             │
│  ├─ src/server/jobs        enqueue / claim / progress / retry (SQLite)                         │
│  └─ src/server/storage     ./data/assets file IO                                               │
│                                                                                                │
│  Worker process (`tsx src/worker/index.ts`)  ← same code, separate process                     │
│  └─ polls `jobs` table → runs pipeline steps → writes assets + rows → emits progress events    │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
                 │ HTTPS                                  
                 ▼                                         
           Muse API (chat + image)                         
```

**Why a separate worker process:** image generation takes roughly 10–60 s per call and a character needs 5–7 calls. Route handlers must return quickly, and Next dev-mode hot reload would otherwise kill in-flight jobs. `npm run dev` runs `concurrently "next dev" "tsx watch src/worker"`. Both processes open the same SQLite file in **WAL mode**.

**Progress events:** the worker writes rows to `job_events`. `/api/events?characterId=` is an SSE route that tails that table (it polls every 500 ms, which is cheap on SQLite) and pushes to the browser. This avoids Redis and websockets and keeps the clone-and-run promise.

---

## 3. Muse API integration

Muse provides both the planner/chat model and the image model. All Muse calls go through **one module**, `src/server/ai/muse.ts`, and are exposed behind two interfaces. Muse is the default, and swapping in another provider later means adding one adapter.

```ts
// src/server/ai/types.ts
export interface ChatModel {
  chat(req: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolDef[];                 // JSON-schema tools
    responseSchema?: JSONSchema;       // structured output when no tools
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<ChatResult>;             // { text?, toolCalls?: {name,args}[], usage }
  stream?(...): AsyncIterable<ChatDelta>;
}

export interface ImageModel {
  readonly caps: {
    referenceImages: number;           // max refs accepted (sheet, prev strip, layout guide)
    nativeTransparency: boolean;       // real alpha out?
    sizes: Array<[number, number]>;    // allowed output sizes, e.g. [1536,1024]
    edit: boolean;                     // supports image-to-image / edit endpoint
  };
  generate(req: {
    prompt: string;
    references?: Buffer[];             // PNGs
    size: [number, number];
    transparent?: boolean;
    seed?: number;
    signal?: AbortSignal;
  }): Promise<{ png: Buffer; raw: unknown; usage?: unknown }>;
}
```

### 3.1 Muse capabilities to verify before Phase 1 (task for the tech lead)
The pipeline depends on these. Each row lists the fallback if Muse lacks the capability.

| Needed | Why | Fallback if missing |
|---|---|---|
| **Reference-image input** on image gen (≥2 images) | Identity consistency: every strip is conditioned on the sheet plus the layout guide | **Blocker.** At minimum we need 1 reference image (the sheet), with the layout described in text. If there is no image input at all, quality is not viable. Escalate. |
| Landscape output size (≈1536×1024 or wider) | Fits 4–6 frames per strip | Use square 1024 and cap strips at 4 frames, using more strips |
| Native transparent background | Skips chroma keying | Generate on a flat chroma key (default magenta `#FF00FF`) and key it out (§5.3). This is the default path anyway. |
| Tool/function calling on chat | Agent loop (§7) | Use JSON-mode with a schema: ask for `{intent, plan}` and validate with zod, retrying once on parse failure |
| Vision input on chat | The agent looks at the current frames/sheet when the user says "fix the hand in frame 3" | Send only text metadata (frame descriptions saved from the plan) |
| Streaming | Typing effect in chat | Show a non-streamed response with a "thinking…" state |
| Seed / determinism | Reproducible re-rolls | Store the prompt and refs. Without a seed a re-roll is simply a new sample. |

### 3.2 Configuration
`.env.local` (`.env.example` is committed):
```
MUSE_API_KEY=
MUSE_BASE_URL=            # default from Muse docs
MUSE_CHAT_MODEL=          # e.g. muse-…  (fill from Muse docs)
MUSE_IMAGE_MODEL=
CHAR2D_DATA_DIR=./data
CHAR2D_MAX_PARALLEL_IMAGE_JOBS=2
```
A **Settings** page shows whether a key is detected and has a "Test connection" button that makes one cheap chat call. Keys are never stored in SQLite or sent to the browser.

### 3.3 Client rules
- All requests run server-side only (`import 'server-only'`).
- Retry 429 and 5xx with exponential backoff and jitter, at most 3 attempts. Don't retry on 4xx or content-policy errors, and show the user the reason.
- Every call logs `{model, prompt hash, latency, tokens/usage, cost estimate}` to `ai_calls` for debugging and a cost display.
- Save the raw image response in `assets/<char>/raw/` so the pipeline can be re-run without paying again.

---

## 4. Data model (SQLite / Drizzle)

All ids are `text` (nanoid). Timestamps are `integer` unix ms. JSON columns are `text` validated by zod on read.

```ts
characters
  id, name, description,
  view_type        'side_scroller' | 'top_down',
  status           'draft' | 'generating' | 'ready' | 'error',
  source_asset_id  → assets           // user upload
  sheet_id         → character_sheets // active sheet
  style_json       { logicalHeight: 48|64, paletteSize: 24, outline: true,
                     chromaKey: '#FF00FF', mirrorLeft: true, cellW, cellH }
  palette_json     string[]           // locked shared palette from the sheet
  atlas_asset_id   → assets           // current composed atlas
  manifest_json    Manifest            // current runtime manifest (§6.1)
  atlas_version    integer             // cache-busting
  created_at, updated_at

character_sheets
  id, character_id, version,
  raw_asset_id, processed_asset_id,
  views_json   { front:{rect}, back:{rect}, right:{rect}, … }  // extracted anchors
  anchors_json { down: assetId, up: assetId, right: assetId }  // per-direction idle anchor PNGs
  prompt, status, created_at

actions
  id, character_id,
  key          'walk' | 'attack_spin' …   (slug, unique per character)
  label, icon (emoji or pixel icon id),
  is_default   boolean,
  directions_json  ['right'] | ['down','up','right']
  active_version_id → action_versions
  gameplay_json    ActionGameplay (§6.4)
  sort_order, created_at, updated_at

action_versions                 // every generation/adjustment = new version → undo/redo
  id, action_id, version, parent_version_id,
  plan_json        ActionPlan (§7.3)    // poses, timing, canvas, playback
  frames_json      { [direction]: FrameRef[] }   FrameRef = { assetId, w, h, anchorX, anchorY, durationMs }
  strips_json      { [direction]: { rawAssetId, segment, prompt }[] }
  status           'queued' | 'generating' | 'processing' | 'ready' | 'error',
  error, created_by ('default' | 'chat' | 'manual'), chat_message_id,
  created_at

input_bindings
  id, character_id, profile ('p1' | 'p2'),
  action_id, device ('keyboard' | 'gamepad'),
  code  ('KeyJ' | 'ArrowLeft' | 'pad:0' …),   // KeyboardEvent.code, not key
  trigger ('press' | 'hold' | 'toggle'),
  UNIQUE(character_id, profile, device, code)

chat_messages
  id, character_id, role ('user'|'assistant'|'tool'),
  content, tool_calls_json, attachments_json, created_at

jobs
  id, type ('sheet'|'strip'|'process_action'|'compose_atlas'|'export'),
  character_id, action_version_id, payload_json,
  status ('queued'|'running'|'done'|'error'|'cancelled'),
  attempts, max_attempts, run_after, locked_by, locked_at,
  depends_on_json  string[],            // job ids that must be 'done' first
  error, created_at, updated_at

job_events      id (autoincrement), job_id, character_id, kind, data_json, created_at
assets          id, character_id, kind, path, mime, width, height, bytes, sha256, created_at
ai_calls        id, kind ('chat'|'image'), model, request_hash, latency_ms, usage_json, ok, error, created_at
playground_scenes  id, world ('side_scroller'|'top_down'), name, characters_json, created_at  // optional saved sessions
```

**Job claiming:** run `UPDATE jobs SET status='running', locked_by=?, locked_at=? WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_after<=? AND <deps done> ORDER BY created_at LIMIT 1) RETURNING *` inside `BEGIN IMMEDIATE`. On worker boot, stale `running` jobs (locked more than 5 minutes ago) go back to `queued`.

---

## 5. Sprite generation pipeline

### 5.1 Overview

```
user image
   │  (A) normalize: EXIF rotate, cap 2048px, PNG
   ▼
(B) CHARACTER SHEET  ── 1 image call ──►  sheet_raw.png
   │  (C) extract views → per-direction idle anchors, detect pixel grid, build palette
   ▼
for each action × direction:
   (D) PLAN (LLM or default preset) → ActionPlan (frames, poses, timing, canvas)
   (E) STRIP  ── 1 image call per ≤N frames ──►  strip_raw_k.png
   (F) PROCESS (deterministic): key → split → snap → palette → outline → align → cells
   ▼
(G) COMPOSE ATLAS (deterministic): all active versions → atlas.png + manifest.json
```

Only **B** and **E** call the image model, and only **D** (for chat actions) calls the LLM. Everything else is deterministic and pure, so it can be unit-tested with fixtures.

### 5.2 (B) Character sheet

**Goal:** turn the user's image into a clean, on-model, **pixel-art anime** turnaround on a flat key background. This image becomes the identity source for the whole character. Following sprite-gen's identity ownership: *the base/user image is used only to make the sheet, and later strips reference the sheet anchors, never the original upload.*

**Layout guide image**, generated by code (`pipeline/guides.ts`): a 1536×1024 canvas, chroma-filled, with faint cell outlines and a baseline. The view sets differ by type:

| view_type | Sheet cells (left → right) |
|---|---|
| side_scroller | `right` (side, facing right) · `front` · `back` (3 cells; front/back are for consistency and portraits) |
| top_down | `down` (front 3/4 overhead) · `up` (back) · `right` (side) |

**Prompt template** (`pipeline/prompts/sheet.ts`; final wording to be tuned against Muse):
```
Create a character turnaround sheet for a 2D video game.
Style: anime-inspired pixel art, chibi proportions (head ≈ 1/3 of height), crisp square pixels,
limited palette (~24 colors), 1px dark outline, flat cel shading, no anti-aliasing, no gradients,
no text, no shadows on the ground.
Character: <user description or "the character in the reference image">. Preserve hair style and
color, outfit, accessories, and color scheme from the reference.
Layout: exactly 3 full-body poses standing in a neutral idle stance, one per invisible slot of the
attached layout guide, left to right: <views>. Same size, same feet baseline, same scale, each
fully inside its slot with padding; poses must not touch or overlap.
Background: perfectly flat solid <#FF00FF> everywhere outside the character. Do not use <key color>
anywhere on the character.
```
References: `[user_image, layout_guide]`.

**Chroma key choice:** sample the user image's dominant hues and pick the key furthest away from them, from {magenta `#FF00FF`, green `#00FF00`, cyan `#00FFFF`, blue `#0000FF`} (this ports sprite-gen's `--chroma-key auto`). Store the result in `style_json.chromaKey`.

**User review (gate):** show the sheet with "Looks good" / "Regenerate" / "Regenerate with note…". Default actions are queued **only after acceptance**, because a bad sheet poisons every strip. Give the user an "auto-accept" toggle for the fast path.

### 5.3 (C) Sheet processing
1. **Chroma removal** (`pixel/chroma.ts`): remove pixels within a distance threshold of the key (default 96 in RGB space), then unmix edge pixels into despilled RGB plus alpha (ported from sprite-gen `remove_chroma_background`). If the model returned real alpha, skip this step.
2. **Connected components** (`pixel/components.ts`): flood-fill alpha blobs, then pick the K largest as poses, sorted by x. Smaller blobs (detached hair strands, sparkles) attach to the nearest pose. If K is wrong, **retry generation once**, then surface an error to the user.
3. **Pixel grid detection** (`pixel/grid.ts`): estimate the pixel pitch per pose by edge-to-gridline alignment (sprite-gen `detect_pixel_pitch`) and take the median. This gives `logicalHeight`, the character's height in real pixels, typically 40–64.
4. **Snap** each pose to its logical grid: dominant colour per block, binarized alpha.
5. **Palette lock:** median-cut over all sheet poses to `paletteSize` (default 24) gives `characters.palette_json`. **Every later frame is quantized to this palette.** This one rule removes most of the frame-to-frame colour flicker.
6. Save each pose as an anchor PNG (`anchors_json`), both at logical resolution and as an 8× nearest-neighbour upscale. The upscale is the reference we attach to strip prompts (models read big crisp pixels better).

### 5.4 (D) Action plan
The default actions use **presets** (`pipeline/presets.ts`, no LLM call) with hand-written per-frame pose descriptions. Example for `walk`:
```ts
walk: {
  frames: 6, fps: 10, playback: 'loop', canvas: 'standard',
  poses: [
    'contact: right foot forward heel down, left foot back, arms opposite',
    'down: weight on right leg, body lowest',
    'passing: left leg passes right, body highest',
    'contact: left foot forward heel down, right foot back',
    'down: weight on left leg, body lowest',
    'passing: right leg passes left, body highest',
  ],
}
```
Chat-created actions get their plan from the agent (§7.3). The schema is identical.

**Canvas shapes:** `standard` (cell 1:1.25), `wide` (attacks with weapon reach or effects, 1.75:1.25), `tall` (big vertical poses, 1:1.75). The planner picks one, and the shape drives the layout guide and the cell size of that action.

### 5.5 (E) Strip generation: the atlas row
- **One image call = one horizontal strip** of up to `MAX_FRAMES_PER_STRIP` frames, 6 by default. sprite-gen's validation found that 4–6 is stable and that 9+ causes duplicates and merged poses.
- **More frames needed?** Split into segments of ≤6 and generate them **sequentially**. Segment *k* gets the references `[anchor, layout_guide_k, last frame(s) of segment k-1]`, plus prompt text giving its frame range ("frames 7–12 of 12, continuing from the attached previous frames"). After processing, the segments are concatenated into one logical row. Different actions and directions run **in parallel**, limited by `CHAR2D_MAX_PARALLEL_IMAGE_JOBS`.
- **Layout guide** for the strip: `frames × cellW` by `cellH` (scaled to the model's allowed size), with invisible slots, a baseline, and safe margins.
- **References:** `[direction anchor (8×), layout guide, (optional) previous segment]`. **Never the original upload** (identity rule).
- **Prompt template** (`pipeline/prompts/strip.ts`, adapted from sprite-gen `row_prompt`):
  ```
  Create a single horizontal sprite strip of exactly {N} frames for the character in the attached
  anchor image, facing {direction}, performing "{label}": {plan.summary}.
  Frame-by-frame poses (left to right):
  1. {pose1} … N. {poseN}
  Rules:
  - Identity lock: copy face, hair, outfit, colors, outline weight, proportions and accessories
    exactly from the anchor. This strip owns motion only.
  - Animate IN PLACE: feet stay on the same baseline unless the pose is airborne; the character does
    not travel across the strip. Same scale in every frame.
  - One pose per invisible slot of the attached layout guide; poses never touch or overlap; keep
    padding inside each slot.
  - Effects (slashes, sparks, dust) only if listed in the pose text, and they must stay inside the
    same slot and touch the character.
  - Same pixel-art style as the anchor: crisp square pixels, ~24 colors, 1px dark outline,
    no anti-aliasing, no motion blur.
  - Background: perfectly flat solid {key}; never use {key} on the character.
  ```
- **Mirroring:** if `mirrorLeft`, the `left` direction is produced in post by `flipX` on processed frames. No image call.

### 5.6 (F) Strip processing (deterministic, `pipeline/process.ts`)
1. Chroma removal (as in §5.3).
2. Component extraction → exactly N poses. On a count mismatch, try `projection` segmentation (sprite-gen `separate_fused_poses`: a vertical cut at minimum-cost projection). If that fails, the job fails with `extract_mismatch`, auto-retries generation once, then reports to the user.
3. Pixel snap with the **sheet's pitch** as a hint (per-frame pitch detection with the median as fallback).
4. Quantize to the **locked character palette**.
5. Optional 1px outline (on by default for the anime pixel style).
6. **Registration:** align frames on the anchor point. `anchorX` = alpha-weighted centroid of the lower 30% of the body (stable feet); `anchorY` = lowest opaque row (the baseline) for grounded frames. For airborne frames (flagged in the plan), keep the vertical offset relative to frame 1's baseline so the jump pose reads correctly while physics handles the real height.
7. **Fit to cell:** upscale to integer scale 1× (we store **logical-resolution** frames; the renderer scales with nearest-neighbour). Place each frame in the action's cell (`cellW×cellH` in logical pixels, e.g. 48×60 standard) at the anchor.
8. Basic QA flags, stored on the version and shown as warnings: empty or sparse frame, near-duplicate frames (dHash), frame-size outliers, leftover key pixels.

### 5.7 (G) Atlas composition (`pipeline/atlas.ts`)
- One atlas per character. **One row per (action, direction)**, frames left to right. Rows use the max frame count; for wide actions the row height/width follows that action's cell. Composition uses **absolute rects**, so the runtime never infers a grid.
- Mirrored directions are **not baked** into the atlas. The manifest marks them `mirrorOf: 'right'` and the renderer flips them. (This keeps the atlas small; the export option can bake them.)
- Output: `atlas@1x.png` (logical pixels), `manifest.json`, `atlas_version++`. Runs after any action version becomes `ready` or is selected (undo/redo). It is cheap: under 50 ms for a typical character.
- Use **sharp** for PNG IO and raw RGBA buffers; all pixel algorithms work on `Uint8ClampedArray`.

### 5.8 Cost and latency budget (target)
| Step | Calls | Notes |
|---|---|---|
| Sheet | 1 image (+1 retry worst case) | |
| Defaults (side_scroller) | 4 image | parallel ×2 → about 2 rounds |
| Defaults (top_down) | 6 image | |
| New chat action | 1 chat + 1 image per direction per ≤6 frames | e.g. attack R (+mirror) = 1 image |
| Retime / gameplay tweak | 1 chat, **0 image** | |

Show a pre-run estimate ("This will make 2 image generations") in the plan card (§7.4).

---

## 6. Runtime contracts

### 6.1 `manifest.json` (single source of truth for both renderers)
```ts
type Manifest = {
  version: 1;
  characterId: string;
  viewType: 'side_scroller' | 'top_down';
  atlas: { url: string; width: number; height: number; version: number };
  pixelScale: number;              // suggested on-screen integer scale, e.g. 3
  actions: Record<string /*action key*/, {
    label: string;
    playback: 'loop' | 'once' | 'once_hold';     // once → returns to locomotion; once_hold → holds last frame while input held
    directions: Record<Direction, {
      mirrorOf?: Direction;                       // 'left' → mirrorOf 'right'
      frames?: { x: number; y: number; w: number; h: number;
                 anchorX: number; anchorY: number; // feet point inside the rect
                 durationMs: number }[];
    }>;
    gameplay: ActionGameplay;
    events?: { frame: number; name: 'hit' | 'footstep' | 'spawn' | string }[]; // optional hooks
  }>;
};
type Direction = 'right' | 'left' | 'up' | 'down';
```
Per-frame `durationMs` (instead of only fps) lets the AI do timing edits such as "hold the wind-up longer" with no regeneration.

### 6.2 Phaser adapter
`lib/game/manifestToPhaser.ts` converts the manifest into a Phaser `TextureAtlas` JSON (frame names `<action>/<dir>/<i>`) plus `anims.create` configs with per-frame `duration`. Mirrored directions use the source frames, and the sprite sets `flipX`. The Character Maker preview reuses the same timing helpers, so both renderers stay identical.

### 6.3 Character controller state machine (`lib/game/controller.ts`)
Shared logic, unit-tested, with the world providing physics:

```
            ┌──────── locomotion layer (driven by input + physics) ────────┐
side:       idle ⇄ walk ;  any grounded → jump (airborne) → land → idle/walk ; grounded+down → crouch
top_down:   idle[dir] ⇄ walk[dir]  (dir = last non-zero input; diagonals pick the dominant axis)
            └──────────────────────────────────────────────────────────────┘
            ┌──────── action layer (custom actions, priority over locomotion) ┐
            press  → play once, lock per gameplay.lockMovement, then return
            hold   → loop while held (e.g. "block", "charge"), release → return
            toggle → enter/exit a loop state (e.g. "sit")
            └──────────────────────────────────────────────────────────────┘
```

### 6.4 `ActionGameplay` (tunable without regenerating images)
```ts
type ActionGameplay = {
  trigger: 'press' | 'hold' | 'toggle';
  lockMovement: boolean;              // can't steer during action
  interruptible: boolean;
  cooldownMs?: number;
  rootMotion?: { dx: number; dy: number; overMs: number };  // dash / lunge, in px (logical)
  // locomotion-only:
  moveSpeed?: number;                 // walk px/s
  jumpVelocity?: number; gravityScale?: number;  // jump
  crouchSpeedMultiplier?: number;
};
```
"Make the jump floatier" becomes `gravityScale: 0.7` plus longer airborne frame durations. That is **zero image calls**.

### 6.5 Input bindings
- Use `KeyboardEvent.code` (layout-independent) and the Gamepad API (`navigator.getGamepads()`, standard mapping).
- **Default profiles**
  - side_scroller P1: `A/D` move, `W` or `Space` jump, `S` crouch. P2: `←/→`, `↑`, `↓`.
  - top_down P1: `WASD`. P2: arrow keys.
  - Custom actions: auto-assign the first free key from `J K L U I O` (P1) or `Numpad1-6` (P2); the user can change it.
  - Gamepad: D-pad/left stick move, A = jump, B = crouch, X/Y/LB/RB = custom actions.
- **Binding UI:** each action chip has a key badge. Clicking it opens a "Press a key…" capture modal (Esc cancels, Backspace clears). Conflicts within a profile show inline: "J is already used by *Fireball*: swap?".
- Bindings are stored per character per profile. The Playground resolves them when you assign a character to P1/P2.

---

## 7. Chat agent (adjust vs create)

### 7.1 Responsibilities
Given the user's message, the character context, and the chat history, the agent must:
1. **Classify intent:** `create_action` · `adjust_action` (visual regen) · `retime_action` / `tune_gameplay` (no regen) · `rebind` · `rename/delete` · `question/other`.
2. **Resolve the target** for an adjust: match against existing action keys and labels ("the jump", "that attack I just made", the most recently edited action when the message is ambiguous).
3. **Plan:** frames, per-frame pose text, durations, canvas, playback, directions, gameplay params, effects.
4. **Act:** call tools to queue jobs and update rows.
5. **Reply** briefly in plain language, including what will be generated and the cost.

### 7.2 Tools (JSON-schema, validated by zod server-side)
```ts
get_character()                       // view type, actions (key, label, frames, durations, gameplay, bindings)
create_action({ key, label, icon, directions, plan: ActionPlan, gameplay, binding?: {code, trigger} })
adjust_action({ actionKey, mode: 'regenerate' | 'regenerate_frames',
                plan: ActionPlan, frameIndices?: number[], note: string })
retime_action({ actionKey, durationsMs: number[] | { fps: number }, playback? })
tune_gameplay({ actionKey, patch: Partial<ActionGameplay> })
set_binding({ actionKey, code, trigger, profile? })
rename_action({ actionKey, label }) / delete_action({ actionKey })   // delete requires confirm
```
Rules in the system prompt:
- Use a no-image tool (`retime_action`, `tune_gameplay`) whenever the request can be met by timing or physics alone.
- Keep the default actions' keys; the agent may adjust but not delete them.
- Never put displacement in the poses (in-place rule). Put movement in `gameplay.rootMotion`.
- Frame budget: 2–6 frames for most actions; >6 only when the user asks for "smooth/long", which triggers multi-strip generation.
- Respect the view type: in top_down, a new action needs `down, up, right` (with left mirrored) unless it is a non-directional effect such as an emote ("only down").
- Ask a clarifying question **only** when the target is truly ambiguous (two equally likely actions).

### 7.3 `ActionPlan` schema
```ts
type ActionPlan = {
  summary: string;                      // one line for prompt + UI
  frames: number;                       // total, may exceed 6 → multi-strip
  poses: string[];                      // length === frames, concrete body positions
  durationsMs: number[];                // length === frames
  playback: 'loop' | 'once' | 'once_hold';
  canvas: 'standard' | 'wide' | 'tall';
  airborneFrames?: number[];            // registration hint (§5.6)
  effects?: string;                     // e.g. "blue crescent slash arc in frames 3–4, attached to blade"
  events?: { frame: number; name: string }[];
};
```

### 7.4 Chat UX
- Messages stream in. When the agent calls a generating tool, it posts a **Plan card** in the chat: action name, frame thumbnails as text pose lines, a timing bar, the estimated number of image calls, and **[Generate] [Edit plan] [Cancel]**. Default: auto-generate for changes with ≤2 image calls. Bigger changes need a click (this is a setting).
- During generation the action chip shows a progress ring. Stage overlay: "Generating strip 1/2 → Processing → Ready".
- When ready, the new version auto-plays on stage, and the chip gets a version dropdown (v1, v2, …) for **undo/redo** (`active_version_id`).
- Example routings:
  | User says | Intent | Image calls |
  |---|---|---|
  | "make walking faster" | `tune_gameplay(moveSpeed↑)` + `retime_action(fps↑)` | 0 |
  | "the jump should be floatier" | `tune_gameplay(gravityScale↓)` + retime the airborne frames longer | 0 |
  | "add a sword slash on J" | `create_action(attack_slash, wide, 5 frames)` + binding | 1 |
  | "the slash should have a fire trail" | `adjust_action(regenerate)` with effects | 1 |
  | "fast forward dash" | `create_action(dash, 4 frames, rootMotion dx=96 overMs=200)` | 1 |
  | "frame 3 of the crouch looks broken" | `adjust_action(regenerate_frames [2])`* | 1 |

  *`regenerate_frames` regenerates the whole strip, using the current strip as a motion reference with the instruction to change only frame k. The pipeline then **splices in only the requested frame indices** and keeps the others.

### 7.5 Agent implementation
- `src/server/ai/agent.ts`: a loop of at most 4 turns: model call → execute tool calls → feed results back → final text. Persist every message and tool call in `chat_messages`.
- Context sent each turn: the system prompt, a compact JSON summary of the character (not images), and the last 20 messages. If Muse chat accepts images, attach the current sheet anchor for visual questions.
- Route: `POST /api/characters/:id/chat` streams the response (SSE/ReadableStream). Job progress comes through `/api/events`.

---

## 8. API surface (Next route handlers, `runtime = 'nodejs'`)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/characters` | multipart: image, name, description, viewType → creates character, queues `sheet` job |
| GET | `/api/characters` | gallery list |
| GET/PATCH/DELETE | `/api/characters/:id` | detail incl. manifest, actions, bindings; rename; delete (removes assets) |
| POST | `/api/characters/:id/sheet/accept` | accept sheet → queues default action jobs |
| POST | `/api/characters/:id/sheet/regenerate` | `{note?}` |
| GET | `/api/characters/:id/actions` | list with versions |
| POST | `/api/characters/:id/actions/:key/versions/:vid/activate` | undo/redo |
| PATCH | `/api/characters/:id/actions/:key` | manual retime, gameplay, label, playback |
| POST | `/api/characters/:id/actions/:key/regenerate` | manual re-roll |
| PUT | `/api/characters/:id/bindings` | replace binding set (validated, conflict-checked) |
| POST | `/api/characters/:id/chat` | streaming agent turn |
| GET | `/api/characters/:id/chat` | history |
| GET | `/api/events?characterId=` | SSE job progress |
| GET | `/api/assets/:id` | file stream, immutable cache headers (content-addressed) |
| POST | `/api/characters/:id/export` | zip: atlas, manifest, phaser json, gifs |
| GET | `/api/settings/health` | Muse key present + test call |

Validate every input with zod. Upload limits: ≤10 MB; png/jpg/webp. Decode with sharp to strip metadata.

---

## 9. Frontend

### 9.1 Stack
- Next.js App Router, React 19, TypeScript strict.
- **Tailwind CSS v4** with design tokens (§10) as CSS variables. Hand-made components; no heavy UI kit. Radix primitives (Dialog, Tooltip, DropdownMenu) for accessibility.
- **TanStack Query** for server state, with SSE events invalidating queries. **Zustand** for local stage/playground state.
- **Phaser 3** loaded only on `/playground` via `next/dynamic` with `ssr:false`.

### 9.2 Pages and layout

**`/` Home:** logo hero, "Create character" CTA, and a gallery grid of character cards (idle animation looping on hover, view-type badge).

**`/create` Wizard (3 steps):**
1. Upload (drag-drop, paste, camera on mobile) with a preview.
2. View type: two big illustrated cards, **Side-scroller** (shows "← → Jump Crouch") and **Top-down** (shows "↑ ↓ ← →"), plus name/description and an advanced drawer (pixel height 48/64, palette size, mirror left/right).
3. Sheet generation: a progress animation (pixel sparkles from the logo), then the review gate (§5.2).

**`/characters/[id]` Character Maker**
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [logo]  Char2D      ‹Character name ✎›   view: Side-scroller   [Export] [▶ Play]│
├──────────────┬───────────────────────────────────────────────┬────────────────┤
│ ACTIONS      │                                               │ INSPECTOR      │
│ ▸ Idle   [—] │               ╔═════════════╗                 │ Action: Walk   │
│ ▸ Walk  [A/D]│               ║   (sprite)  ║  ← stage, bg    │ Version v2 ▾   │
│ ▸ Jump   [W] │               ╚═════════════╝    toggles      │ Frames ▮▮▮▮▮▮  │
│ ▸ Crouch [S] │   ◀ ▶ facing   ⏯  0.5× 1× 2×  onion ☐         │ Timing bar     │
│ ▸ Slash  [J] │   ───●──────── frame scrubber 3/6             │ Playback loop ▾│
│ + New action │                                               │ Gameplay sliders│
│              │                                               │ Binding [J] ✎  │
├──────────────┴───────────────────────────────────────────────┴────────────────┤
│ 💬 chat history (collapsible drawer, plan cards inline)                         │
│ [ Ask to adjust or add an action… e.g. "add a spinning kick on K"     ] [Send ▶]│
└───────────────────────────────────────────────────────────────────────────────┘
```
- The stage canvas renders with `imageSmoothingEnabled = false` at integer scale, auto-fit. It listens to bound keys while focused, so you can test-drive the bindings: in the Maker, keys trigger animations only (no physics).
- Clicking an action chip plays it once (or loops it if it is a loop). Each chip shows a status ring and QA warning icons.
- The timing bar is a draggable per-frame duration editor that saves via PATCH with no AI.
- The chat drawer opens when you focus the input. Suggestion chips show the view's common requests ("Add attack", "Make walk faster", "Add dash").

**`/playground`**
- Top bar: a **World switcher** with two tabs, *Side-scroller* and *Top-down*. The incompatible tab is disabled with a tooltip ("No top-down characters yet").
- Left panel: compatible characters. Drag them into the world, or use "Add". Assign **P1 / P2 / NPC**. `Tab` cycles which character P1 controls.
- An on-screen key legend shows each player's bindings. A touch D-pad and buttons appear on coarse pointers.
- Phaser scene features:
  - **SideScrollerScene:** a 3-screen-wide level built from a code-generated tile map (ground, floating platforms, a pit), parallax background (2–3 layers), Arcade physics with gravity, camera follow with deadzone and world bounds, coyote time 80 ms and jump buffer 100 ms (feel), crouch reducing the hitbox height.
  - **TopDownScene:** a 40×30 tile map (grass, paths, trees, water as colliders), 4-dir movement with normalized diagonals, y-sort depth, camera follow, simple collision.
  - Both scenes: characters are scaled so their `logicalHeight` maps to about 1.5 tiles. Shadows are ellipse sprites under the feet. Custom actions run `rootMotion` as a tween/velocity override.
- World art: ship a small **CC0 pixel tileset** in `public/worlds/` (e.g., a Kenney pack; check its license and credit it in NOTICE) recolored toward the brand palette. The worlds must not need AI generation to run.

### 9.3 Shared front-end modules
```
src/lib/manifest.ts        types + zod schema (shared with server)
src/lib/anim/timeline.ts   frame-at-time helpers (used by SpritePlayer + tests)
src/components/SpritePlayer.tsx
src/lib/game/controller.ts state machine (pure, unit-tested)
src/lib/game/input.ts      keyboard/gamepad → per-profile intent
src/lib/game/manifestToPhaser.ts
src/game/scenes/{SideScrollerScene,TopDownScene,Boot}.ts
```

---

## 10. UI and visual design (matching the logo)

The look is a **bright, clean, "pixel-cute"** interface: a white or very light canvas, the logo's **blue → cyan → teal → green** gradient as the hero accent, chunky pixel details (stepped corners, pixel sparkles "✚"), and rounded, friendly type. Think of a modern creative tool wearing pixel-art clothing, not a dark retro arcade.

### 10.1 Tokens (sampled from the logo)
```css
:root {
  /* brand gradient stops (logo wordmark, left→right) */
  --c2d-blue-700: #0456F8;   /* deep "C" */
  --c2d-blue-500: #0F7DF8;
  --c2d-sky-400:  #0BA4F1;
  --c2d-cyan-400: #09BFD7;
  --c2d-teal-400: #20CBA0;   /* mid wordmark / hair highlight #20E1C6 */
  --c2d-green-500:#34BE69;
  --c2d-lime-400: #73D945;   /* "D" top / sparkles */
  --c2d-navy-800: #1740B4;   /* mascot outline/shadow → text-strong on light */
  --c2d-gold-400: #F5B623;   /* belt buckle accent — use sparingly (warnings, coins) */

  --grad-brand: linear-gradient(90deg, #0456F8 0%, #0BA4F1 35%, #20CBA0 65%, #73D945 100%);

  /* surfaces (light, default) */
  --bg:        #F7FBFF;      /* near-white with blue tint */
  --surface:   #FFFFFF;
  --surface-2: #EEF6FF;
  --border:    #D4E4F7;
  --text:      #0E1B3D;
  --text-muted:#5B6B8C;
  --focus:     #0BA4F1;
  --danger:    #F0475C;
}
/* dark mode: --bg #0B1430, --surface #111D42, --surface-2 #182756, --border #24376E,
   --text #EAF3FF, --text-muted #9DB0D9; brand stops unchanged */
```

### 10.2 Typography
- Display/headings: **Fredoka** (rounded geometric, close to the "Char2D" wordmark).
- Pixel accents (key badges, frame counters, world names, button labels in the Playground): **Pixelify Sans** (more readable than Press Start 2P). Use it for short strings only.
- Body/UI text: **Nunito**.
- Load all three through `next/font/google` (self-hosted at build time, so no runtime CDN).

### 10.3 Components and motifs
- **Pixel buttons:** solid brand-gradient fill, 2px navy "pixel" border made with stepped `box-shadow` corners (no border-radius on primary buttons), and a 2px press-down offset on `:active`. Secondary buttons are white with a navy pixel border.
- **Cards and panels:** white, 12px radius, 1px `--border`, with a soft blue shadow `0 4px 0 #D4E4F7` (a flat, pixel-ish drop).
- **Key badges:** small keycaps rendered in Pixelify Sans, `[J]`, with a 2px bottom "keycap" shadow.
- **Sparkles:** the logo's ✚ pixel crosses as a decorative SVG sprite. They twinkle around the stage on generation success, and an idle field fades in on loading states.
- **Stage:** a light checkerboard by default (`#EEF6FF` / `#FFFFFF`), plus options for a "grass" strip, "sky", and dark.
- **Progress:** a pixel progress bar filled with the brand gradient in 8 px steps.
- **Iconography:** 16×16 pixel icons (play, pause, flip, onion, gamepad), drawn as SVG `<rect>`s so they stay crisp at any scale.
- **Motion:** a 150–200 ms ease-out on UI transitions. Respect `prefers-reduced-motion` by turning off sparkles and the bounce.
- **Accessibility:** contrast ≥ 4.5:1 for text. The gradient is used only on large text and fills, with white text on blue/teal and navy text on green/lime. Use `:focus-visible` rings. Every control has a keyboard path, and the key-capture modal is screen-reader labelled.

Copy `media/logo.jpeg` to `public/brand/` and make a transparent PNG/SVG variant, plus a favicon from the mascot head.

---

## 11. Repository layout

```
char2d/
├─ README.md                  quick start, screenshots, Muse setup, credits
├─ LICENSE (Apache-2.0)       NOTICE  ← sprite-gen attribution + tileset credits
├─ .env.example
├─ package.json               scripts below
├─ drizzle.config.ts
├─ data/                      (gitignored) char2d.db, assets/
├─ public/brand/, public/worlds/, public/fonts?
├─ src/
│  ├─ app/
│  │  ├─ page.tsx, create/, characters/[id]/, playground/, settings/
│  │  └─ api/… (route handlers, §8)
│  ├─ components/             ui/ (Button, Panel, KeyBadge, Sparkles…), maker/, playground/
│  ├─ lib/                    manifest, anim, game (shared client+server pure code)
│  ├─ game/scenes/            Phaser scenes
│  ├─ server/
│  │  ├─ db/ (schema.ts, migrate.ts, repo/*.ts)
│  │  ├─ ai/ (types.ts, muse.ts, agent.ts, tools.ts, prompts/system.ts)
│  │  ├─ pipeline/ (guides.ts, presets.ts, sheet.ts, strip.ts, process.ts, atlas.ts, export.ts, prompts/)
│  │  ├─ pixel/ (chroma.ts, components.ts, segment.ts, grid.ts, snap.ts, palette.ts, outline.ts, register.ts, qa.ts)
│  │  ├─ jobs/ (queue.ts, handlers/*.ts, events.ts)
│  │  └─ storage/ (assets.ts)
│  └─ worker/index.ts
├─ tests/                     vitest unit (pixel/*, controller, timeline, manifest), fixtures/*.png
└─ e2e/                       Playwright: create (with mocked Muse) → maker → playground
```

`package.json` scripts:
```json
{
  "dev": "concurrently -n web,worker \"next dev\" \"tsx watch src/worker/index.ts\"",
  "build": "next build",
  "start": "concurrently -n web,worker \"next start\" \"tsx src/worker/index.ts\"",
  "db:generate": "drizzle-kit generate",
  "test": "vitest",
  "e2e": "playwright test",
  "lint": "eslint . && tsc --noEmit"
}
```
Requirements: Node ≥ 20. `better-sqlite3` and `sharp` ship prebuilt binaries for macOS, Linux, and Windows, so there are no system dependencies. Migrations run automatically at worker and web start (`migrate()` guarded by a file lock).

**Mock mode:** `CHAR2D_FAKE_AI=1` swaps Muse for a fixture provider that returns canned sheets and strips from `tests/fixtures/`. Contributors can run the whole app and the e2e tests without a key, which matters for an open-source repo.

---

## 12. Porting notes from sprite-gen (what to take, what to skip)

| sprite-gen piece | Char2D | File |
|---|---|---|
| `sprite-request.json` numeric SSoT | `characters.style_json` + `ActionPlan` | — |
| `prepare.draw_guide` layout guides | Port | `pipeline/guides.ts` |
| `row_prompt` (identity lock, slot rules, anchor ownership) | Port and simplify | `pipeline/prompts/strip.ts` |
| Idle-anchor ownership (base used only pre-anchor) | Keep as a hard rule | §5.2 |
| `remove_chroma_background` (unmix, despill) | Port | `pixel/chroma.ts` |
| `--chroma-key auto` | Port | `pixel/chroma.ts` |
| `connected_components` / `extract_component_frames` | Port | `pixel/components.ts` |
| `separate_fused_poses` (projection DP) | Port (fallback only) | `pixel/segment.ts` |
| pixel-unfake: pitch detect, phase snap, dominant color, alpha binarize | Port the core; skip runlen crosscheck v1 | `pixel/grid.ts`, `pixel/snap.ts` |
| `build_shared_palette` / `apply_palette` | Port, but lock the palette from the **sheet** | `pixel/palette.ts` |
| `enforce_outline`, `register_row_frames` | Port | `pixel/outline.ts`, `pixel/register.ts` |
| `manifest.json.frame_layout` absolute rects | Same idea, our schema | §6.1 |
| Frame-count guidance (4–6 stable) | `MAX_FRAMES_PER_STRIP = 6` | — |
| Curation webview, breathing, recolor, video pipeline, scene renderer, providers codex/grok | **Skip for v1** (the video→loop pipeline is a v2 idea if Muse offers video) | — |

Port approach: read the Python, write TS with the same function names and comments that cite the source file, and build **golden tests**: run sprite-gen on 3–4 fixture strips and assert that our TS output matches within a tolerance (frame count, bboxes ±1 px, palette size).

---

## 13. Milestones

Each phase is shippable on its own and comes with acceptance criteria.

**Phase 0: Skeleton (2–3 days)**
- Next app, Tailwind tokens, fonts, logo, layout shell; Drizzle schema plus auto-migrate; worker plus job queue plus SSE; asset storage; `CHAR2D_FAKE_AI` provider.
- ✅ `npm i && npm run dev` on a fresh clone shows the home page. A fake job's progress shows up in the browser.

**Phase 1: Muse and sheet (3–4 days)**
- MuseClient (chat + image) with health check, the §3.1 capability spike (write the findings into `docs/muse.md`), the create wizard, sheet generation, chroma key, components, grid detect, palette lock, and the review gate.
- ✅ An uploaded anime image produces an accepted pixel sheet with 3 clean transparent anchors on ≥4 of 5 test images.

**Phase 2: Strips and atlas (4–5 days)**
- Presets, strip generation, multi-strip segments, processing (snap, palette, outline, register), atlas plus manifest, mirroring, QA flags.
- ✅ Both view types generate all default actions automatically. The manifest validates. The frames show no visible key fringe, the palette stays consistent, and the feet don't jitter in idle/walk.

**Phase 3: Character Maker (4–5 days)**
- SpritePlayer, stage controls, action list, inspector (timing bar, gameplay sliders, versions), binding editor with conflict detection, keyboard test-drive.
- ✅ Every default action plays from both chips and keys. Retiming persists. Undo/redo between versions works.

**Phase 4: Chat agent (4–5 days)**
- Agent loop, tools, plan card, streaming, intent routing, `regenerate_frames` splicing.
- ✅ All six example prompts in §7.4 route to the intended tools in a scripted eval (`tests/agent.eval.ts`, run against Muse with recorded fixtures). "Add X on K" produces a new action bound to K.

**Phase 5: Playground (5–6 days)**
- Phaser boot, manifest → atlas, controller state machine, both worlds, compatibility gating, multi-character P1/P2/NPC, gamepad, touch controls.
- ✅ A side-scroller character runs, jumps, and crouches across platforms; a top-down character walks in 4 directions with y-sort; the incompatible world is disabled; two characters play at once on separate key profiles; custom actions fire from their bindings.

**Phase 6: Polish and open-source release (3 days)**
- Export zip and GIFs, README with GIFs, CONTRIBUTING, e2e in CI (GitHub Actions, fake AI), error states, empty states, dark mode, reduced motion.
- ✅ A fresh clone passes `npm test && npm run e2e` with no API key.

Total: about 5–6 weeks for one full-stack developer, or about 3 weeks for two, split as (pipeline + AI) and (UI + game).

---

## 14. Testing strategy
- **Unit (vitest):** every `pixel/*` function on small synthetic images (a known pitch, a known key, fused blobs), `timeline`, the `controller` state machine (table-driven input → state), manifest zod round-trips, and binding conflict logic.
- **Golden:** fixture strips → processed frames compared to committed PNGs, with a per-pixel tolerance.
- **Agent eval:** about 20 scripted user prompts → expected tool + key args (fuzzy). Run it manually against real Muse before releases and in CI against recorded responses.
- **E2E (Playwright, fake AI):** create → accept sheet → defaults ready → add an action via chat → bind → open the playground → press keys → assert the animation name on the Phaser sprite (expose `window.__char2d` debug hooks in dev/test builds only).

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Muse lacks reference-image conditioning, or it is weak | The Phase 1 spike happens first. If it is weak, strengthen the prompt with explicit appearance text auto-extracted from the sheet by the chat model (vision), and offer "regenerate". This is a known blocker; escalate early. |
| Identity drift between strips | Sheet-anchor-only references, a locked palette, the identity-lock prompt block, and pixel snap. The user can re-roll one action without touching the others. |
| The model ignores the frame count or poses fuse | Layout guide, component extraction plus projection fallback, auto-retry once, then a clear error with a "re-roll" button. |
| Walk cycles look stiff or wrong | 6-frame preset poses, timing editable without regeneration. Label walk as "best-effort" in QA, which matches sprite-gen's experience. |
| Jitter between frames | Feet-anchor registration plus integer placement. |
| Long waits | Parallel strips, SSE progress, the sheet gate first so failures happen early, and an option to play partial results (idle is ready before walk). |
| SQLite contention between the two processes | WAL mode, short transactions, `busy_timeout=5000`. |
| Licensing | Code: Apache-2.0 plus sprite-gen NOTICE. Tilesets: CC0 only. Generated assets belong to the user. Follow Muse's terms in the README. |

---

## 16. Open questions for the product owner
1. "Geometric view": this plan assumes a **4-direction overhead (3/4 top-down, JRPG-style)** world. If true **isometric** (diamond tiles, diagonal facings) is required, top_down becomes 4–8 diagonal directions and the world becomes an isometric tilemap. The data model already supports it; the cost is about +3 days in Phase 5.
2. Should one character be allowed to support **both** view types? That would mean generating both default sets and making both worlds available for it. This plan currently says one view type per character.
3. Auto-generate threshold: should chat actions start generating immediately, or always show the plan card for confirmation first?
4. Muse pricing and rate limits: these determine `MAX_PARALLEL_IMAGE_JOBS` and whether to show cost estimates in currency.
