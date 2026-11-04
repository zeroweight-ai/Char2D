# Character ZIP archives

Choose **Export → All frames (ZIP)** on a character with published animations. Restore that download through **New character → Upload a ZIP → Import character**. The name is optional on import; leaving it blank preserves the exported name. Import creates a new ready character, preserves the original, and makes no AI calls. No API key or running worker is needed to import or play the restored character.

## Contents

| Path | Contents |
| --- | --- |
| `character.json` | Versioned Char2D metadata used for import: name, style, palette, moves, controls, frame timing, anchors, scale, gameplay, and sound cues. |
| `frames/<move>/<direction>/001.png` | Native-resolution PNGs for every published animation frame, including materialized mirrored directions. Frame numbers start at 001. |
| `sheet.png` | Accepted transparent character sheet. |
| `sheet-raw.png` | Original sheet image, when available. |
| `anchors/` | Identity reference crops, when available. |
| `sounds/` | Published move sounds, when available. |
| `atlas.png`, `manifest.json` | Published sprite atlas and manifest with relative image/audio paths for game-engine use. |
| `README.txt` | Brief instructions included in the download. |

Only published moves are exported. Historical versions, pending generations, chat history, raw animation strips, API keys, and provider responses are excluded.

## Import behavior

The importer reads `character.json` (format `char2d-character`, version `1`) and the referenced PNG/audio files. It rebuilds the atlas from individual frames, assigns fresh character/asset IDs, and restores accepted move versions and keyboard bindings. Mirrored directions retain their relationship to their source. Imported moves remain available in Play, Moves, Controls, and Playground; they can be retimed, edited, or regenerated using the usual workflow. Regeneration uses the configured AI provider as usual.

An arbitrary ZIP of images is not a Char2D character archive: the timing and move metadata in `character.json` are required. Retain the exported paths and metadata when transferring a character.

Archives are limited to 100 MB compressed, 300 MB unpacked, and 4,096 files. PNGs are decoded and validated before a character is created; malformed images, missing frames, invalid controls, unsupported archive versions, and unsafe or duplicate paths are rejected. Archive paths are never extracted to the filesystem.

## API

- `GET /api/characters/:id/export` returns an attached ZIP download. Characters without published animations return `409`; missing characters return `404`.
- `POST /api/characters/import` accepts multipart fields `archive` (the ZIP) and optional `name`. Success returns `201` with `{ id, imageCalls: 0 }`. Invalid archives return `400`; size-limit failures return `413`.
