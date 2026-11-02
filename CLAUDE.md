# Char2D

One image (or a text description) → an animated pixel-art game character. Next.js 15 (App Router, React 19) + SQLite (Drizzle) + a separate job worker + Muse API (Meta's OpenAI-compatible image/chat models). Full design: `PLAN.md` (milestones in §13). Muse API notes: `docs/muse.md`. Pipeline history/decisions: `docs/setup.md`.

## Status (as of 2026-11-02)

- Phases 0–3 of `PLAN.md` done: skeleton, sheet generation + review, default action strips + atlas, Character Maker (inspector, retiming, version undo/redo, key bindings).
- Phase 4 (chat agent) **partial**: single-prompt custom actions exist (`CustomAction.tsx` → plan + generate). No chat loop, no adjust-vs-create routing, `chat_messages` table unused.
- Phase 5 (Playground/Phaser worlds) **not started**: `/playground` is a static world-map placeholder; `src/lib/game/` only has a README. Phaser is installed but unused.
- Phase 6 (export zip/GIF, dark mode, CI) not started. Exports today: atlas PNG + manifest JSON downloads.
- Known open issue: Muse often draws walk frame 3 with the same leg in front as frame 1 on characters with asymmetric legs. `sameLegOrder` detects it (retry once, then a QA warning) but does not fix it. Proposed next step: describe the legs by appearance from frame 1 and regenerate only frame 3.

## Commands

```bash
npm run dev          # next dev (:3000) + worker (tsx watch) via concurrently
npm run lint         # eslint + tsc --noEmit (use this as the typecheck)
npm test             # vitest, tests/**/*.test.ts (server-only is aliased to tests/server-only.ts)
npm run e2e          # Playwright; starts its OWN next dev on :3100 + worker, CHAR2D_FAKE_AI=1, data in ./data/e2e
npm run db:generate  # drizzle-kit: after editing src/server/db/schema.ts → new SQL in drizzle/
npm run art:generate # Muse-generates UI art into public/game/ (paid; skips existing, --force to redo)
npm run brand:build  # transparent logo variants from media/logo_high.png → public/brand/, src/app/icon.png
```

- **Never run `npm run e2e` while a `next dev` is running in this repo.** Both share `.next/`, the build manifest gets clobbered, and the running dev server 404s every route until restarted.
- e2e is fully free (fake AI). Real Muse calls cost money; avoid them unless asked, and say how many you made.
- Migrations apply automatically on DB open (`src/server/db/migrate.ts`); no manual step.

## Environment

`.env` / `.env.local` (both git-ignored; `.env.example` is committed). Key vars: `MUSE_API_KEY`, `CHAR2D_FAKE_AI` (`1` = deterministic fake provider, `0` = real Muse), `CHAR2D_DATA_DIR` (default `./data`). The user's local `.env` is set to `CHAR2D_FAKE_AI=0` (real Muse). Env is read at process start, so restart dev after changes. A yellow fixed banner (`layout.tsx`) shows when fake mode is on.

## Architecture

- **Web** (`src/app`) handles UI + API routes (all `runtime="nodejs"`). **Worker** (`src/worker/index.ts`) polls the SQLite job queue (`src/server/jobs/queue.ts`) and runs `generateSheet` / `runAnimationJob`. Progress streams over SSE (`/api/events?jobId=|characterId=`).
- **AI provider**: `src/server/ai/index.ts` picks `FakeProvider` or `MuseProvider` from config. Image generation with references goes to `/images/edits`. Muse returns opaque PNGs, so everything is drawn on a chroma-key colour and keyed out locally (`src/server/pixel/chroma.ts`).
- **Assets**: content-addressed files in `data/assets/<2 hex>/<sha256>.png`, rows in `assets` table, served by `/api/assets/[id]`.
- **DB** (`src/server/db/schema.ts`): `characters` (holds published `manifestJson` + atlas pointer), `character_sheets`, `actions` (`activeVersionId`, `gameplayJson`, `bindingsSeeded`), `action_versions` (`planJson`, `framesJson`, `stripsJson`; immutable history), `input_bindings`, `jobs`, `job_events`, `ai_calls`.

### Generation pipeline (`src/server/pipeline/`)

1. **Sheet** (`sheet.ts`, prompt `prompts/sheet.ts`): 3-view sheet → chroma key → anchors per direction. User reviews, then accepts (`sheet/accept`) or revises (Muse decides edit-latest vs fresh, `ai/revision.ts`).
2. **Accept** (`server/characters/animations.ts#acceptAndAnimate`) queues per default action: `process_action:prepare` → `strip` jobs per direction → `process_action:finish` → one `compose_atlas`. Defaults (`presets.ts`): side view = idle, walk, jump, crouch (directions `right` only, left mirrored); top-down/three-quarter = idle, walk (down/up/right).
3. **Strips** (`animations.ts` `strip` branch, prompt `prompts/strip.ts`, walk poses `prompts/walk.ts`): actions are ≤4 frames (`MAX_FRAMES_PER_ACTION`). Frames are kept at **native sheet resolution**, so tall characters split into batches (`nativeBatchSize`, usually 2 frames per call). References passed per call: `[anchor, slot guide, previous strip's last frame?, frame 1 of this action?, idle frame?]`; prompt text names them by position (FIRST/SECOND/THIRD/LAST), so **if you change the reference order, update the prompt text and `tests/animation-pipeline.test.ts` reference-count asserts.**
4. **QA after extraction** (`frames.ts` extract + `pose-checks.ts`): an `extract_mismatch:` error triggers one retry with the message fed back as "CORRECTION REQUIRED"; a second failure becomes a QA warning. Checks: later-batch size vs frame 1 (idle ±12%, walk ±20%, comparing width *and* height, because Muse fills the canvas height even when it zooms in and cuts off the feet); walk frame 3 vs frame 1 foot order (side views only). Do **not** add a "pose touches canvas edge" check: good Muse strips routinely touch top and bottom.
5. **compose_atlas**: stacks the given `versionIds`' frames into one atlas PNG, builds the manifest (`src/lib/manifest.ts` schema), sets each action's `activeVersionId`, character `status=ready`.

Regenerating an action creates a new version and recomposes. Walk regeneration always uses fresh preset poses; other actions reuse their saved plan. "Reprocess" re-extracts saved raw strips with no AI call.

### Character Maker features (no AI calls)

- `PATCH /api/characters/:id/actions/:key` (`server/characters/edit.ts#updateAction`): retime (`durationsMs`), `playback`, `gameplay`, `label`. Mutates the **active version's** plan/frames and patches the published manifest in place (atlas unchanged). Rejected (409) while any job is queued/running.
- `POST .../actions/:key/versions/:vid/activate`: undo/redo = enqueue `compose_atlas` with that version.
- Bindings: `src/lib/bindings.ts` (shared rules) + `server/characters/controls.ts`. `GET/PUT /api/characters/:id/bindings` (PUT replaces one profile; server re-validates). Movement keys are fixed per view/profile (side P1 A/D, P2 ←/→; top-down P1 WASD, P2 arrows) and drive `walk`; idle/walk aren't bindable. A key may do only one thing across both profiles. Defaults are seeded once per action (`ensureBindings`, guarded by `actions.bindings_seeded`) so a cleared key stays cleared; this is the only place defaults are created. Legacy rows binding walk are ignored on read.
- `getCharacter` (`server/characters/repository.ts`) is the single detail payload the UI polls: includes manifest, per-action `versions`, `activeVersion`, `gameplay`, and `bindings`.

## Frontend

- Pages: `/` title screen (`TitleActions`: one primary CTA, "My characters" only when some exist) + gallery + "How it works"; `/create` single-panel 3-step form (source + dropzone, name, view); `/characters/[id]` (`CharacterSheet.tsx`); `/playground` placeholder map; `/settings` AI connection + worker demo job (`DemoJob`, moved off the home page).
- UX rule of thumb: one primary action per screen, advanced controls behind a click. The character page shows exactly one panel per state: drawing → review (accept is the only big button; revision note below) → animating (progress + per-move status) → workspace. The workspace is tabs (`role=tab`): **Play** (chips + "+ New move", stage, Pause/frame/Facing, "View ▾" menu for zoom/speed/background/flip, "Edit move" opens `ActionInspector`; open state lives in `CharacterSheet` so it survives atlas remounts), **Moves** (`CustomAction` "Add a new move" + move rows with Regenerate/Delete), **Controls** (`ControlsPanel`), **Character sheet** (image + redraw). Only the active tab is mounted. HUD holds status pill, "Export ▾" menu (atlas, manifest, sheet) and a quiet Delete. Dropdowns are `<details class="menu">`, closed on outside click/Escape by `providers.tsx`.
- `AnimationPreview` is a mini controller: **window-level** key listener (ignores inputs/selects/textarea, `[data-keys-ignore]` subtrees, open dialogs, modifier keys). Held keys are tracked; `press` moves play through and then `resolveRef` picks the next state from what is still held (toggle → hold-move → walk direction → idle); `hold` loops while held; `toggle` flips. Inspector timing edits preview live via a draft before save.
- Styling: a single hand-written `src/app/globals.css` (Tailwind imported but barely used). Game look: sky gradient on a fixed `.sky` layer with drifting CSS pixel clouds, notched pixel borders made with four flat box-shadows (`.panel`), gold chunky buttons, `<progress>` styled as an XP bar, grass/dirt footer. Fonts: Silkscreen (display), Pixelify Sans (UI), Nunito (body), Fredoka (wordmark).
- Art: `public/game/*.png` (Muse-generated via `scripts/generate-ui-art.ts`), brand logo variants in `public/brand/`. The preview stage's default "Meadow" backdrop (`arena.png`) is sized `auto 105%` so its ground line meets the sprite's feet.

## Testing conventions

- **e2e selectors depend on exact accessible names**; keep these stable or update the specs: link "▶ Create a character"; tabs "Play"/"Moves"/"Controls"/"Character sheet"; testid `hero-status` (text "Ready to play" = animations done); buttons "Looks good — accept sheet", "Generate character sheet", "Regenerate {Label}", "Delete {Label}" (visible text is just "Regenerate"/"Delete"; the name comes from aria-label), "Restore native frames: {Label} (no AI call)", "Pause", "Edit move", "Create move", "Undo to vN"/"Redo to vN", "Swap keys"; headings "Your transparent character sheet", "Character sheet"; labels "Character name", "Describe your character", "Animation frame", "Animation direction", "Preview zoom", "What should your character do?"; testid `sprite-player` (exposes `data-action`, `data-direction`, `data-frame`). Move chips use `aria-label={label}` so their visible key badges don't change the name.
- Fake AI yields 4-frame actions, and a re-roll of walk reports `imageCalls: 1`.
- `tests/strip-prompt.test.ts` and `tests/animation-pipeline.test.ts` assert prompt phrases (e.g. walk pose titles "Contact A — NEAR-SIDE LEG IN FRONT"); update them when prompt wording changes.

## Gotchas

- Code style in this repo is dense (many statements per line, few spaces). Match the surrounding file instead of reformatting.
- `src/lib/*` is shared client/server (zod schemas, bindings rules). Server-only modules import `"server-only"`.
- Root layout is `force-dynamic` (it reads `config.fakeAI` for the banner).
- When writing throwaway Node scripts against the codebase, use `.mts` (top-level await) with `npx tsx`, and remove them afterwards.
