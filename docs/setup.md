# Repository setup

This repository implements Phase 0, character-sheet creation, and default animation generation through Phase 2 of [the technical plan](../PLAN.md). It has a Next.js 15 / React 19 app, Tailwind v4, strict TypeScript, SQLite / Drizzle, automatic migrations, an independent worker, persistent jobs, SSE events, content-addressed asset storage, and fake/Muse provider adapters.

## Run locally

Use Node 22 LTS (22.18 or newer). Then:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The default configuration enables fake AI; it needs no key. Click **Run demo job** on the home page. The worker claims a SQLite job, sends progress through `/api/events`, saves a synthetic fixture, and the browser displays the preview.

To connect Muse, set these values in `.env.local` and restart both processes:

```dotenv
CHAR2D_FAKE_AI=0
MUSE_API_KEY=your-key
MUSE_BASE_URL=https://api.meta.ai/v1
MUSE_CHAT_MODEL=muse-spark-1.3
MUSE_IMAGE_MODEL=muse-image-1.0
```

Open Settings to inspect key presence and test the active provider. The Muse connection test makes one chat call. The home-page demo always uses a fixture and never makes a paid call, even with Muse enabled. Real Muse calls have not been capability-tested as part of setup.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next and the worker together. |
| `npm run dev:web` | Start just Next. |
| `npm run dev:worker` | Start just the worker. |
| `npm run build` | Build the production app. |
| `npm start` | Run the production web server and worker after building. |
| `npm run lint` | ESLint and strict TypeScript checking. |
| `npm test` | Run the unit tests once. |
| `npm run test:watch` | Watch unit tests. |
| `npm run db:generate` | Generate a migration after changing the schema. Commit the generated `drizzle/` files. |
| `npm run db:migrate` | Apply committed migrations manually. |
| `npx playwright install chromium` | Install the browser needed by the smoke test. |
| `npm run e2e` | Run the fake worker/SSE/preview and settings browser smoke test on port 3100. |

Data lives in `./data` by default and is ignored by Git. Web and worker must use the same `CHAR2D_DATA_DIR`. Tests use temporary databases; Playwright uses `./data/e2e`. SQLite runs in WAL mode with foreign keys enabled and a five-second busy timeout. Migrations and their journal updates run within a SQLite `BEGIN IMMEDIATE` transaction, which serializes startup across processes and releases the lock on a crash.

Server modules use `server-only`. Worker and migration commands run with `--conditions=react-server` so they can import the same modules outside Next. Do not import them from client components. The health endpoint never returns a key. The Muse adapter hashes request bodies for logging and stores usage and latency in `ai_calls`.

## API implemented in Phase 0

- `GET /api/settings/health`: database readiness, provider mode, model names, and key presence. No paid call.
- `POST /api/settings/test`: one chat call to the active provider.
- `POST /api/jobs/demo`: queue a free fixture job; returns `202` and `jobId`.
- `GET /api/events?jobId=...` or `?characterId=...`: stream ordered job events. Supports `Last-Event-ID` and `after` for reconnects.
- `GET /api/assets/:id`: serve an immutable saved asset with an ETag.

## Next implementation steps

- Quality follow-up: more Muse fixtures, advanced pixel-pitch detection and phase snapping, and richer extraction/registration QA. Default presets, direction anchors, strips, and atlases are implemented.
- Phases 3–5: Character Maker, planner tool loop, bindings, and Phaser worlds.
- Phase 6: exports, broader tests, CI, and release polish.

The create page supports both upload and prompt modes, and character pages show generation progress and sheet review. `demo`, `sheet`, `strip`, `process_action`, and `compose_atlas` have worker handlers. Export jobs are not implemented yet. The fake provider uses the static sheet fixture and deterministic animated strips, allowing the real processing and atlas pipeline to run. The playground remains a placeholder.

Accepting a sheet atomically queues direction-anchor preparation, default strips, action validation, and atlas composition. The character becomes `ready` only after the complete default atlas and manifest are published. Repeated acceptance is idempotent and does not enqueue more image calls.

The initial provider interfaces cover plain chat and single-request image generation/editing. Tool loops, encrypted reasoning replay, structured planner output, and conversation-aware image editing remain later-phase work. Consult [Muse reference](muse.md) before extending the adapters. Muse returns opaque images, rejects seed, and interprets image sizes as aspect ratios rather than exact dimensions. Image request responses expose raw data for future pipeline persistence.

No sprite-gen algorithms or third-party tilesets are included in the skeleton. Preserve source attribution and notices when porting them later.

The Fredoka, Nunito, and Pixelify Sans fonts are bundled through Fontsource CSS packages rather than fetched by `next/font/google` at build time. This keeps builds independent of Google Fonts connectivity. Each package includes its upstream font license.

Dependency overrides pin Next’s PostCSS and drizzle-kit’s legacy esbuild dependency to patched releases. Recheck the overrides when upgrading those tools.

## Generate a real Muse image from the command line

Set `MUSE_API_KEY` in `.env.local`, then run:

```sh
npm run muse:image
# Or provide your own prompt:
npm run muse:image -- "A pixel-art knight standing on a solid magenta background"
```

This command always uses the real Muse provider, even if fake mode is enabled. It makes a paid image request, validates the returned PNG, stores an asset record, and saves a convenient preview at `data/muse/latest.png`. Request metadata and the raw response are saved alongside it so the output can be inspected without generating again. All outputs stay in the gitignored data directory. The default prompt generates an original three-view pixel character sheet; it does not use an uploaded reference image.


## Create a character sheet

1. Click **Create a character** and select **Upload an image** or **Describe a character**.
2. Provide a name, appearance description (required for prompt mode), and game view. Upload mode accepts a non-animated PNG/JPEG/WebP up to 10 MB and 24 megapixels; the server rotates, caps at 2048 pixels, and re-encodes it as PNG to remove metadata.
3. Submit the form. The background worker calls the configured provider, saves the raw image and response, then removes the key color and saves an RGBA PNG. Live progress is streamed over SSE; polling provides a fallback.
4. Review the transparent sheet, download it, accept it, or regenerate with an optional note. Previous sheet versions remain stored.

Background selection maximizes distance from sampled upload colors and colors named or specified as hex in the description/revision. Preferred keys are magenta, green, cyan, and blue, with red/yellow fallbacks if necessary. If no candidate is safely separated, the request fails with guidance instead of knowingly choosing a matching key. This is a heuristic, not a guarantee of model adherence: the prompt reserves the key for the background, and post-processing rejects missing/nonuniform backgrounds or nearly empty results. Review the result for accidental holes or omitted details before accepting.

Chroma removal handles enclosed background gaps, unmixes contaminated edges, and preserves images that already have substantial transparency. Raw images are retained independently, so the pipeline can later reprocess them without another paid generation. No image-model support for native transparency is assumed.

Implemented character APIs: `GET/POST /api/characters`, `GET /api/characters/:id`, `POST /api/characters/:id/sheet/regenerate` (`{note?}`), and `POST /api/characters/:id/sheet/accept` (`{sheetId}`). Concurrent sheet generation is rejected, and acceptance verifies the reviewed sheet is still current.

Tests cover both create modes, input rejection, PNG alpha, acceptance, regeneration, and persistence after reload using fake AI. Real Muse capability/quality evaluation remains separate from these automated tests.


## Revision strategy

A nonempty revision note with an existing completed sheet first goes to Muse Spark for a validated JSON decision:

- **Edit latest**: attach the most recent completed transparent sheet as the Muse Image reference. The latest sheet is authoritative, so prior visual revisions are preserved unless the new note changes them. Background selection also samples this sheet's retained colors.
- **New sheet**: generate a fresh result from the original description plus the newest note. For upload-created characters, attach the original upload; prompt-created characters use text-to-image without an old sheet reference.

Muse chooses based on intent, preferring edits for incremental changes and fresh generation for explicit restarts or replacements. An empty note requests a fresh variation without a planner call. If no completed sheet exists, generation starts fresh. A failed newer attempt does not replace the last usable reference.

The queued job snapshots the prior sheet's ID and reference asset. Its strategy, reason, final prompt, key color, and selected reference are saved before image generation; a resumed job reuses that decision. The review page shows the strategy and reason, including after refresh. A malformed planner decision is retried once, then reported as an error without generating an image. Nonempty planned revisions add a small chat call to the image-generation cost. Fake mode uses a deterministic test planner and makes no real calls.

Regression tests verify the actual reference bytes sent for both strategies, prompt-only restarts with no image reference, saved decisions across resumed jobs, planner validation, and strategy display in the browser.


## Default animation generation

After reviewing the sheet, click **Looks good — accept sheet**. Previously accepted sheets without animations offer **Generate default animations**. Real Muse mode uses at least 5 strip image calls for side-scroller (idle 4 frames, walk 6, jump 4, crouch 2) or at least 9 for top-down (idle 4 and walk 6, each in down/up/right directions). Left is mirrored by default. A frame-count extraction failure triggers one additional image attempt for that strip. Failed work can be retried from the page; valid raw strips and finished directions are reused.

The job graph runs these steps:

1. Extract three poses from the accepted transparent sheet using connected components, with projection-valley segmentation as a fallback. Keep native-resolution direction crops for identity references without resizing or palette reduction. These algorithms are original Char2D implementations.
2. Generate each default action/direction from its sheet anchor plus a generated layout guide. The original upload is never used for strips. Actions longer than four frames are segmented sequentially, with the preceding segment's final pose as a third reference.
3. Save raw strips and provider responses; remove the background and extract native-resolution poses. Preserve source detail and colors: no logical-height resizing, grid quantization, or palette reduction. Trim each sprite to visible bounds plus one transparent pixel and register its feet using crop-adjusted pivots. No outline is synthesized. Airborne frames retain their vertical offset. Processing emits extraction, duplicate-frame, and undersized-output warnings.
4. Validate every direction, then compose one atlas row per action/direction using absolute rectangles. Publish atlas PNG plus validated manifest JSON and atomically activate the new action versions. Mirrored left directions reference right frames instead of duplicating pixels.

Generation progress uses SSE plus polling. The page exposes failure details, a retry button, and QA warnings. Sheet regeneration is blocked while animation jobs are active, so generations cannot mix references from different sheets. Existing action versions and source assets remain stored.

The preview reads the shared manifest and timeline helpers: action chips, facing, pause/play, speed, frame scrubbing, flip, and checker/dark/grass backgrounds. Focus the stage for keyboard playback: A/D, W/Space, S in side-scroller; WASD/arrows in top-down. The preview does not simulate physics. Atlas and manifest downloads are available here; Phaser worlds, GIF/ZIP exports, advanced bindings, and action editing are later work.

`GET /api/characters/:id/actions` returns default action/version progress; `POST /api/characters/:id/animations/retry` retries failed graph steps. `GET /api/characters/:id` includes the manifest, animation job totals, action states, and QA warnings. No database migration is needed: the schema already contains these tables.

Current visual processing normalizes to a fixed logical height with nearest-neighbor resizing. Advanced pixel-unfake pitch/phase detection, more robust contact-point registration, and real-Muse golden-image quality evaluation are still follow-up work. Automated tests use fake image generation; they verify both view types, exact default frame counts, correct references, palettes, anchor coordinates, multi-strip continuation, retries, manifest validation, and actual canvas playback without spending API credits.


### Action processing update (2026-10-29)

- Each image request generates **at most four frames**. The six-frame walk is generated as four frames then two; longer plans continue in four-frame batches. Continuation prompts use global frame numbers and include the preceding batch's final pose.
- Different physical image resolutions returned by Muse are rebased to a shared guide space before action-wide scaling, so a shorter final batch cannot enlarge its character relative to the first batch.
- Creation uses a fixed 128-pixel design height; there is no pixel-height selector. The processed transparent sheet retains native resolution and colors. Action frames also preserve native source resolution. The image API's requested size remains an aspect-ratio hint, not a pixel-size guarantee.
- Stored frame PNGs and atlas rectangles are tightly cropped with one transparent pixel of padding. Pivots can lie outside an airborne frame's rectangle; consumers must honor manifest anchor coordinates rather than inferring centering from frame size.
- Sheet and action prompts prohibit added outlines, colored borders, rim lights, glow, and key-colored halos. Anchor/action processing never adds a silhouette stroke; chroma removal still despills edges, partially keyed edge pixels are discarded before extraction, and the locked palette excludes the key color. Existing details present in the reference remain part of the artwork. Model adherence still requires visual review.

These rules apply to newly generated/processed outputs. Existing completed atlases are retained; this update does not make paid regeneration calls automatically.

## Delete characters and actions

Characters have a **Delete character** control in the gallery and detail page. Each action has a **Delete [action name]** control in the character's action list. Both open a confirmation dialog; Cancel leaves the item intact. Defaults, including idle, can be deleted manually.

- `DELETE /api/characters/:id` returns `204`. It removes character-owned sheets, actions, versions, bindings, chat messages, assets, jobs, and job events. Queued jobs are removed atomically. If a worker is running a job for the character, it returns `409`; wait for generation to finish before deleting.
- `DELETE /api/characters/:id/actions/:key` returns `202` with a rebuild `jobId` (or `null` if no playable actions remain). It removes the action and every version/binding, deletes unreferenced frame/strip assets and retired atlases/manifests, and queues deterministic atlas composition using the remaining ready versions. This makes **no AI call**. Queued or running generation for that character returns `409` to prevent races with generation.
- Deleting idle selects a remaining action for preview and ignores keyboard shortcuts for missing actions. Deleting the final action keeps the accepted sheet and shows **No actions remaining**; the atlas/manifest are cleared.

Files are content-addressed and may be shared across characters or asset rows. Cleanup unlinks a file only when no remaining asset row references its path. File creation plus asset insertion and unreferenced-file cleanup are serialized through SQLite write transactions, preventing a same-hash save/unlink race. Action cleanup also checks sheet and other-action references before removing asset rows.

New strip records track their raw response asset ID, allowing those responses to be removed with the action. Legacy unlinked response JSON files remain until the containing character is deleted. Retired atlas jobs are excluded from retry/progress so they cannot resurrect a deleted action. These operations do not require a schema migration.

Unit/integration tests cover cascades, shared files and asset IDs, running-job guards, last-action removal, and atlas rebuilding without model calls. Browser tests cover cancel/confirm, gallery/detail deletion, removal of idle, and valid preview fallback after atlas rebuilding. Tests delete only isolated fake-AI test characters.

## Regenerate one action

Each action row has a **Regenerate [name]** button and an estimated image-call count. Clicking it starts a new manual version of that action using the accepted sheet's direction anchors. The current action plan (poses, frame durations, playback), gameplay settings, directions, and key bindings are preserved. Other actions are reused rather than generated again.

`POST /api/characters/:id/actions/:key/regenerate` returns `202` with `versionId`, the final atlas `jobId`, and `imageCalls`. It rejects missing characters/actions, an unaccepted current sheet, and any queued/running generation for that character. The normal four-frame batch limit applies: a six-frame side-scroller walk uses two image calls; a three-direction top-down walk uses six.

The worker queues anchor preparation, only the selected action's strips, action validation, and atlas composition with the other ready action versions. The old active-version pointer and atlas remain available until publication; after successful composition the new version becomes active atomically. A generation failure leaves the old animation available, with the existing retry flow available for the new work. Older action versions and atlases are retained. Starting a fresh attempt retires superseded failed jobs so they cannot later activate an older failed attempt.

Regeneration uses the configured provider: Muse makes real image calls, fake mode uses fixture strips. No chat-planner call is needed for this button. Tests cover single-action isolation, direction-specific call counts, version publication, binding preservation, failure/retry, and the browser control.

### Empty asset folders

Character/action deletion also sweeps the assets directory recursively, removing empty subfolders from the bottom up. Nonempty folders, symlinks, and the assets root are preserved. The sweep shares the asset-save SQLite lock and uses nonrecursive directory removal, so a folder containing a file is never removed.

To remove pre-existing empty folders without deleting any assets, run:

```sh
npm run assets:clean-empty
```

The command prints the number of folders removed.

## Recover a sheet extraction failure

The extractor now retains component ownership masks when pose bounding boxes overlap. A wide prop can extend into a neighboring rectangle without copying that neighboring character into the extracted PNG. If thin props actually connect, a minimum-ink curved seam can separate them; the sheet review displays a warning. Substantially fused artwork is still rejected rather than cut arbitrarily.

Failed sheets with saved raw images show **Retry saved sheet processing**. `POST /api/characters/:id/sheet/reprocess` queues local processing of the existing image and preserves the saved generation key. It never invokes revision planning or generates a replacement image; missing raw files fail explicitly. No Muse key is required for this operation. If the recovered image is genuinely unusable, regenerate with a note requesting more space between the three poses.


### Fixed sheet height (2026-10-29)

The **Character pixel height** selector has been removed. New character metadata defaults to 128 logical pixels, but that value no longer resizes review sheets, identity crops, or action frames. Existing assets are preserved until explicitly restored or regenerated.


## Full-resolution review and identity references

`character_sheets.processed_asset_id` is the full-resolution RGBA sheet: background removal and edge-alpha cleanup are applied, but **no resizing or palette reduction**. It retains the raw provider image's width and height for review, downloads, and latest-sheet revision references.

After acceptance, native-resolution per-direction crops are saved in `anchors_json` as `sheet_identity_anchor` assets. Muse Image receives these full-detail crops when generating action strips. Action processing uses these native anchors directly and preserves extracted frame resolution and colors.

Previously downscaled sheets offer **Restore full-resolution sheet**, using the saved raw image with no AI call. Existing acceptance and active animation manifests are retained during successful restoration. The original sheet background key is recovered from the saved generation context/prompt rather than the potentially different animation key. Future action generation rebuilds its anchor cache from the restored sheet; existing atlases remain unchanged.

Tests verify native dimensions and opaque pixel colors, full-resolution reference bytes sent to Muse, native action frame pixels and colors, and restoration of accepted sheets without changing their active manifest or making model calls.


## Native action resolution and preview

Strip guides match the native direction crop: the pose fills 88% of guide height. Each request contains at most four frames; large poses use smaller batches to preserve detail within the observed sheet canvas width. Cost estimates include these additional batches. Continuation references retain their native pixels.

Frames and atlases retain returned source pixels after background cleanup and tight cropping. Optional manifest frame `scale` records the relationship between the requested guide and returned strip height; consumers multiply their display scale by this value without rewriting the image. The preview fits all frames around a stable pivot, uses a device-pixel-ratio canvas, and provides **100% source pixels** zoom. Shrinking uses high-quality smoothing; magnification uses nearest-neighbor rendering.

Legacy actions offer **Restore native frames** using saved raw strips through `POST /api/characters/:id/actions/:key/reprocess`. This makes no AI calls and retains the active atlas until successful publication. If detail was already missing from the raw model output, use **Regenerate** to request new native-reference strips instead.


### Resolution target from the approved example

The reference `data/assets/02/024619fb8686938da7ea903b89b65169027e6f63f1fb0084c8d9a8a125624b31.png` is 1920×1280. `src/lib/resolution.ts` defines that canvas target. Sheet generation requests 1920×1280 and prompts for three 640-pixel slots with approximately 1126-pixel-tall standing characters (88% occupancy). Prompts no longer request a 128-pixel logical grid or force a 24–32-color palette. Actions use the accepted pose's actual native dimensions, with guides at matching scale and adaptive strip widths. Muse may return different dimensions; local processing preserves those source pixels rather than manufacturing detail by upscaling. Existing sheets and actions are unchanged until regeneration.


### Character view selection

Step 1 offers Side view (eye-level), Top-down view (steep overhead), and Three-quarter view (45-degree elevated). The selected camera is saved with the character and retained in sheet generation, revisions, action prompts, gallery labels, and manifests. Three-quarter uses the same down/up/right directions, mirrored left, idle/walk presets, and WASD controls as top-down. Existing side/top-down characters retain their selection.

After accepting a character sheet, use **Add a custom action** to describe a movement or emote. **Plan action** uses one chat call and displays an editable pose/timing plan plus an image-call estimate. **Generate custom action** queues strips using the accepted sheet, then publishes an atlas containing the existing actions and the new action. Planning is available while default animations run; generation waits until current jobs finish. Custom actions currently play from the animation preview's action buttons.
