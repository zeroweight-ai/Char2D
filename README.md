<p align="center">
  <img src="media/logo.jpeg" width="240" alt="Char2D — Pixel Character Maker">
</p>

<h1 align="center">Char2D</h1>

<p align="center"><b>One image in. A playable anime pixel-art character out.</b></p>

---

Char2D turns a single image into an animated pixel-art game character. It generates a character sheet, builds sprite atlases for each action, and lets you add or adjust actions by chatting. You can then map actions to buttons and play your characters in a sample side-scroller or top-down world, all in the browser.

## Features

- **Single image → character**: generates a pixel-art character sheet, then sprite sequences from it
- **Default actions per view type**: side-scroller (left, right, jump, crouch) or top-down (up, down, left, right)
- **Chat to animate**: ask for new actions (attack, dash, …) or tweaks to existing ones
- **Button mapping**: bind keys or gamepad buttons to any action
- **Playground**: control one or more characters in sample worlds

## Tech stack

Next.js · React · TypeScript · SQLite · Phaser · Muse API

## Getting started

The repository includes the **character-sheet and default animation workflow**. Start from an uploaded image or a description, review the transparent pixel-art sheet, then accept it to generate default action strips, a sprite atlas, and an animated preview. Action editing and playground worlds are upcoming milestones.

Use **Node 22 LTS** (22.18 or newer):

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Fake AI is enabled by default, so no API key is needed. Click **Run demo job** to verify the worker, live progress, and asset storage.

To use Muse, set `MUSE_API_KEY` and `CHAR2D_FAKE_AI=0` in `.env.local`, restart, and use **Settings → Test connection**.

```bash
npm run lint
npm test
npm run build
npx playwright install chromium
npm run e2e
```

See [setup documentation](docs/setup.md) for scripts and implementation status, [PLAN.md](PLAN.md) for the technical design, and [Muse reference](docs/muse.md) for API integration details. Local data and secrets are ignored by Git.

## Authors

- Minh Anh Nguyen
- Trung Tin Phan

## License

Apache-2.0
