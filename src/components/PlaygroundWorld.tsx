"use client";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CharacterDetail } from "@/lib/character";
import { frameAtTime } from "@/lib/anim/timeline";
import { keyLabel } from "@/lib/bindings";
import { actionFrames, HERO_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT, WorldController } from "@/lib/game/controller";
import { loadSound, playSound, unlockAudio } from "@/lib/anim/sound-player";
import { drawWorldItems } from "@/lib/game/render-items";
import { drawGoblin, GOBLIN_WALK_URL } from "@/lib/game/render-goblin";

const MUTE_KEY = "char2d.preview.muted";
type ControlDirection = "left" | "right" | "up" | "down";

export function PlaygroundWorld({ character, world, onReplay }: { character: CharacterDetail; world: string; onReplay: () => void }) {
  const manifest = character.manifest!;
  const controller = useMemo(() => new WorldController(manifest, character.bindings), [manifest, character.bindings]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const itemsCanvas = useRef<HTMLCanvasElement>(null);
  const goblinCanvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const victory = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [activeAction, setActiveAction] = useState(controller.fallback);
  const [loot, setLoot] = useState({ coins: 0, chests: 0 });
  const [goblinSpawned, setGoblinSpawned] = useState(false);
  const [won, setWon] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const actions = Object.entries(manifest.actions).filter(([key]) => key !== "idle" && key !== "walk");
  const hasSounds = Object.values(manifest.actions).some(action => action.sound);
  const keysFor = (action: string) => [...controller.keys].filter(([, input]) => input.action === action).map(([code]) => code);

  useEffect(() => { stage.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (won && !victory.current?.open) victory.current?.showModal();
    else if (!won && victory.current?.open) victory.current.close();
  }, [won]);
  useEffect(() => {
    try { setMuted(window.localStorage.getItem(MUTE_KEY) === "1"); } catch {}
  }, []);
  useEffect(() => {
    for (const action of Object.values(manifest.actions)) if (action.sound) void loadSound(action.sound.url);
  }, [manifest]);

  useEffect(() => {
    const image = new window.Image();
    const goblinImage = new window.Image();
    let request = 0, cancelled = false;
    const reset = () => controller.reset();
    window.addEventListener("blur", reset);
    const visibility = () => { if (document.hidden) reset(); };
    document.addEventListener("visibilitychange", visibility);
    image.onerror = () => { if (!cancelled) setError("Could not load this character’s animation. Try again."); };
    goblinImage.onerror = () => { if (!cancelled) setError("Could not load the Goblin Soldier animation. Try again."); };
    goblinImage.src = GOBLIN_WALK_URL;
    image.onload = () => {
      if (cancelled) return;
      const context = canvas.current?.getContext("2d");
      const itemsContext = itemsCanvas.current?.getContext("2d");
      const goblinContext = goblinCanvas.current?.getContext("2d");
      if (!context) return;
      let last = 0, lastCue = "", lastAction = "", lastCoins = -1, lastChests = -1;
      let lastGoblinSpawned: boolean | null = null;
      let lastGoblinHealth = -1;
      // The same saved frame scale and foot anchor apply to every custom move.
      const reference = manifest.actions.idle ?? manifest.actions[controller.fallback];
      const height = Math.max(1, ...Object.values(reference.directions).flatMap(value => value.frames?.map(frame => frame.anchorY * (frame.scale ?? 1)) ?? []));
      const zoom = HERO_HEIGHT / height;
      const tick = (now: number) => {
        const dt = last ? Math.min(50, now - last) : 0;
        last = now;
        controller.step(dt);
        const { action, direction, elapsedMs, sequence, x, y } = controller;
        const animation = manifest.actions[action];
        const { frames, mirrored } = actionFrames(manifest, action, direction);
        context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        if (itemsContext) drawWorldItems(itemsContext, controller.items);
        const goblinFrame = goblinContext ? drawGoblin(goblinContext, goblinImage, controller.goblin) : null;
        if (frames.length) {
          const { index } = frameAtTime(frames.map(frame => frame.durationMs), elapsedMs, animation.playback);
          const frame = frames[index], scale = zoom * (frame.scale ?? 1);
          context.save();
          context.imageSmoothingEnabled = scale < 1;
          // The saved foot anchor and collision body share the same world point.
          context.translate(x, y);
          context.scale(mirrored ? -scale : scale, scale);
          context.drawImage(image, frame.x, frame.y, frame.w, frame.h, -frame.anchorX, -frame.anchorY, frame.w, frame.h);
          context.restore();
          const duration = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
          const cycle = animation.playback === "loop" ? Math.floor(elapsedMs / duration) : 0;
          const cue = `${sequence}:${cycle}:${index}`;
          if (cue !== lastCue) {
            lastCue = cue;
            const sound = animation.sound;
            if (!mutedRef.current && sound?.frames.includes(index)) void playSound(sound.url, sound.volume);
          }
        }
        const { coinCount, destroyedChests } = controller.items;
        if (coinCount !== lastCoins || destroyedChests.size !== lastChests) {
          lastCoins = coinCount; lastChests = destroyedChests.size;
          setLoot({ coins: coinCount, chests: destroyedChests.size });
        }
        if (action !== lastAction) { lastAction = action; setActiveAction(action); }
        if (controller.goblin.spawned !== lastGoblinSpawned) {
          lastGoblinSpawned = controller.goblin.spawned;
          setGoblinSpawned(lastGoblinSpawned);
        }
        if (controller.goblin.health !== lastGoblinHealth) {
          lastGoblinHealth = controller.goblin.health;
          setWon(controller.won);
        }
        if (goblinCanvas.current) {
          goblinCanvas.current.dataset.spawned = String(controller.goblin.spawned);
          goblinCanvas.current.dataset.active = String(controller.goblin.active);
          goblinCanvas.current.dataset.x = String(Math.round(controller.goblin.x));
          goblinCanvas.current.dataset.y = String(Math.round(controller.goblin.y));
          goblinCanvas.current.dataset.frame = goblinFrame === null ? "" : String(goblinFrame);
          goblinCanvas.current.dataset.health = String(controller.goblin.health);
          goblinCanvas.current.dataset.defeated = String(controller.goblin.defeated);
        }
        if (canvas.current) {
          canvas.current.dataset.action = action;
          canvas.current.dataset.direction = direction;
          canvas.current.dataset.x = String(Math.round(x));
          canvas.current.dataset.y = String(Math.round(y));
          canvas.current.dataset.grounded = String(controller.grounded);
          canvas.current.dataset.climbing = String(controller.climbing);
          canvas.current.dataset.coins = String(coinCount);
          canvas.current.dataset.chestsDestroyed = String(destroyedChests.size);
          canvas.current.dataset.attacking = String(controller.items.attackProgress !== null);
          canvas.current.dataset.won = String(controller.won);
        }
        if (itemsCanvas.current) {
          itemsCanvas.current.dataset.remainingCoins = String(controller.items.coins.size);
          itemsCanvas.current.dataset.destroyedChests = [...destroyedChests].join(",");
        }
        request = window.requestAnimationFrame(tick);
      };
      request = window.requestAnimationFrame(tick);
    };
    image.src = manifest.atlas.url;
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(request);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      reset();
    };
  }, [controller, manifest, retry]);

  function key(event: KeyboardEvent<HTMLElement>, down: boolean) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Space/Enter on a button retain normal keyboard button behavior.
    if ((event.target as HTMLElement).closest("button") && ["Space", "Enter"].includes(event.code)) return;
    if (!controller.handlesKey(event.code)) return;
    event.preventDefault();
    if (down && !event.repeat) { unlockAudio(); controller.downKey(event.code); }
    else if (!down) controller.up(event.code);
  }

  function control(direction: ControlDirection, source: string) {
    if (direction === "up" || direction === "down") controller.climb(direction, source);
    else controller.move(direction, source);
  }

  function pointer(event: PointerEvent<HTMLButtonElement>, action: string, move?: ControlDirection) {
    event.preventDefault();
    stage.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    unlockAudio();
    if (move) control(move, `button:${action}`);
    else controller.downAction(action, `button:${action}`);
  }

  function holdKey(event: KeyboardEvent<HTMLButtonElement>, action: string, down: boolean, move?: ControlDirection) {
    if (!["Space", "Enter"].includes(event.code)) return;
    event.preventDefault();
    if (!down) controller.up(`button:${action}`);
    else if (!event.repeat) {
      unlockAudio();
      if (move) control(move, `button:${action}`);
      else controller.downAction(action, `button:${action}`);
    }
  }

  return <section aria-label={`${world} with ${character.name}`} onKeyDown={event => key(event, true)} onKeyUp={event => key(event, false)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) controller.reset(); }}>
    <div className="playground-hud" role="group" aria-label="Adventure progress">
      <output aria-label="Coins collected" aria-live="polite"><span aria-hidden="true">●</span> Coins <strong>{loot.coins}</strong></output>
      <span aria-label={`${loot.chests} of ${controller.world.chests?.length ?? 0} treasure chests destroyed`}>Chests {loot.chests}/{controller.world.chests?.length ?? 0}</span>
      {goblinSpawned && !won && <span role="status" aria-label="Goblin count">Goblin <strong>1/1</strong></span>}
    </div>
    {goblinSpawned && <p className="key-hint" role="status" aria-label="World events">{won ? "The Goblin Soldier is defeated!" : "All coins collected! Hit the Goblin Soldier three times with your attack to win."}</p>}
    <div ref={stage} className="playground-stage" tabIndex={0} role="group" aria-label="Village map, keyboard controls">
      <Image key={retry} src="/worlds/village-platformer.png" alt="Pixel-art village with a stone arch, fountain, log bridge and grassy platforms" width={WORLD_WIDTH} height={WORLD_HEIGHT} priority unoptimized className="playground-backdrop" onError={() => setError("Could not load the village map. Try again.")} />
      <canvas ref={itemsCanvas} width={WORLD_WIDTH} height={WORLD_HEIGHT} aria-hidden="true" data-testid="playground-items" />
      <canvas ref={goblinCanvas} width={WORLD_WIDTH} height={WORLD_HEIGHT} aria-hidden="true" data-testid="playground-goblin" data-direction="left" />
      <canvas ref={canvas} width={WORLD_WIDTH} height={WORLD_HEIGHT} role="img" aria-label={`${character.name} exploring ${world}`} data-testid="playground-player" />
    </div>
    {error && <div role="alert"><p className="error">{error}</p><button className="secondary small" onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</button></div>}
    <p className="key-hint">Click the map to play. Use <span className="key">A</span><span className="key">D</span> or <span className="key">←</span><span className="key">→</span> to walk. At the pink ladder, hold <span className="key">W</span>/<span className="key">↑</span> to climb up or <span className="key">S</span>/<span className="key">↓</span> to climb down; release to pause. Jump through grassy ledges to reach higher platforms. Touch coins to collect them. Use your character’s attack beside a treasure chest, then collect the spilled coins. Watch out for spikes! Use the buttons or saved keys below for your moves. Hold a move marked “Hold”; click a toggle move again to stop it.</p>
    <div className="button-row playground-controls" aria-label="Movement controls">
      {(["left", "right", "up", "down"] as const).map(move => <button key={move} className="secondary" aria-label={`${move === "up" || move === "down" ? "Climb" : "Move"} ${move}`} onPointerDown={event => pointer(event, move, move)} onPointerUp={() => controller.up(`button:${move}`)} onPointerCancel={() => controller.up(`button:${move}`)} onLostPointerCapture={() => controller.up(`button:${move}`)} onKeyDown={event => holdKey(event, move, true, move)} onKeyUp={event => holdKey(event, move, false, move)} onBlur={() => controller.up(`button:${move}`)}>{({ left: "←", right: "→", up: "Climb ↑", down: "Climb ↓" })[move]}</button>)}
      {hasSounds && <button className="secondary small" aria-label={muted ? "Unmute sound" : "Mute sound"} aria-pressed={!muted} onClick={() => {
        unlockAudio();
        setMuted(value => { try { window.localStorage.setItem(MUTE_KEY, value ? "0" : "1"); } catch {} return !value; });
      }}>{muted ? "Sound off" : "Sound on"}</button>}
    </div>
    <div className="action-chips playground-actions" role="group" aria-label="Character actions">
      {actions.map(([key, animation]) => {
        const hold = animation.gameplay.trigger === "hold" && key !== "jump";
        const codes = keysFor(key);
        return <button key={key} aria-label={animation.label} aria-pressed={activeAction === key} title={`${animation.label}${codes.length ? ` · ${codes.map(keyLabel).join(" / ")}` : ""}`} onClick={() => {
          if (!hold) { unlockAudio(); controller.downAction(key, `button:${key}`); }
        }} onPointerDown={hold ? event => pointer(event, key) : undefined} onPointerUp={hold ? () => controller.up(`button:${key}`) : undefined} onPointerCancel={hold ? () => controller.up(`button:${key}`) : undefined} onLostPointerCapture={hold ? () => controller.up(`button:${key}`) : undefined} onKeyDown={hold ? event => holdKey(event, key, true) : undefined} onKeyUp={hold ? event => holdKey(event, key, false) : undefined} onBlur={hold ? () => controller.up(`button:${key}`) : undefined}>
          {animation.label}{hold && <small>Hold</small>}{animation.gameplay.trigger === "toggle" && <small>Toggle</small>}{codes.length > 0 && <span className="action-keys" aria-hidden="true">{codes.map(code => <span className="key" key={code}>{keyLabel(code)}</span>)}</span>}
        </button>;
      })}
    </div>
    <dialog ref={victory} className="victory-dialog" aria-labelledby="victory-title" aria-describedby="victory-description" onCancel={event => event.preventDefault()}>
      <span className="victory-star" aria-hidden="true">★</span>
      <span className="kicker">Stage complete</span>
      <h2 id="victory-title">You Win!</h2>
      <p id="victory-description">{character.name} defeated the Goblin Soldier. Ready for another adventure?</p>
      <button autoFocus onClick={onReplay}>Play again</button>
    </dialog>
  </section>;
}
