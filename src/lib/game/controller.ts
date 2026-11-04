import { movementKeys, PROFILES, type Bindings } from "../bindings";
import type { Direction, Manifest } from "../manifest";
import { HERO_BODY, HERO_HEIGHT, HERO_HALF_WIDTH, moveBody, supportAt, VILLAGE_MAP, type Ladder, type WorldMap } from "./world";
import { isAttackAction, WorldInteractions } from "./interactions";
import { GoblinSoldier } from "./goblin";

export { WORLD_WIDTH, WORLD_HEIGHT, WORLD_GROUND, HERO_HEIGHT } from "./world";
// Boost saved character settings to suit the village's larger map coordinates.
const WALK_SPEED_MULTIPLIER = 2, JUMP_POWER_MULTIPLIER = 2.5;
const CLIMB_SPEED = 180;
export const CLIMB_KEYS: Readonly<Record<string, "up" | "down">> = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down" };
type Input = { action: string; direction?: Direction };

export function actionFrames(manifest: Manifest, key: string, direction: Direction) {
  const animation = manifest.actions[key];
  const facing = animation.directions[direction] ? direction : animation.directions.right ? "right" : animation.directions.left ? "left" : Object.keys(animation.directions)[0] as Direction;
  const selection = animation.directions[facing];
  return {
    frames: (selection?.mirrorOf ? animation.directions[selection.mirrorOf]?.frames : selection?.frames) ?? [],
    mirrored: !!selection?.mirrorOf !== (facing !== direction),
  };
}

/** Input and action playback stay independent of the canvas and frame rate. */
export class WorldController {
  x: number;
  y: number;
  direction: Direction = "right";
  action: string;
  elapsedMs = 0;
  sequence = 0;
  private velocity = 0;
  private timeMs = 0;
  private pressed: string | null = null;
  private toggled: string | null = null;
  private held = new Map<string, Input>();
  private climbInputs = new Map<string, "up" | "down">();
  private ladder: Ladder | null = null;
  private climbBlocked = false;
  private cooldowns = new Map<string, number>();
  readonly keys = new Map<string, Input>();
  readonly fallback: string;
  readonly items: WorldInteractions;
  readonly goblin: GoblinSoldier;

  constructor(readonly manifest: Manifest, bindings?: Bindings, readonly world: WorldMap = VILLAGE_MAP) {
    this.x = world.spawn.x;
    this.y = world.spawn.y;
    this.fallback = manifest.actions.idle ? "idle" : Object.keys(manifest.actions)[0];
    this.action = this.fallback;
    this.items = new WorldInteractions(world);
    this.goblin = new GoblinSoldier(world);
    for (const profile of PROFILES) {
      for (const [code, direction] of Object.entries(movementKeys(profile))) this.keys.set(code, { action: "walk", direction });
      const saved = bindings?.[profile] ?? (profile === "p1" ? { jump: ["KeyW", "Space"], crouch: ["KeyS"] } : { jump: ["ArrowUp"], crouch: ["ArrowDown"] });
      for (const [action, codes] of Object.entries(saved)) if (manifest.actions[action]) for (const code of codes) this.keys.set(code, { action });
    }
  }

  private get obstacles() { return this.goblin.active ? [this.goblin.body] : []; }
  private get body() { return { id: "hero-body", left: this.x - HERO_HALF_WIDTH, right: this.x + HERO_HALF_WIDTH, top: this.y - HERO_HEIGHT, bottom: this.y }; }
  get grounded() { return !this.climbing && this.velocity === 0 && !!supportAt(this.world, this.x, this.y, HERO_BODY, this.obstacles); }
  get climbing() { return this.ladder !== null; }
  get won() { return this.goblin.defeated; }

  handlesKey(code: string) { return this.keys.has(code) || Object.hasOwn(CLIMB_KEYS, code); }

  downKey(code: string) {
    if (this.won) return;
    const vertical = CLIMB_KEYS[code];
    // Ladder controls take precedence only in reach of the ladder. Elsewhere
    // these keys still invoke the character's saved jump/crouch/custom move.
    if (vertical && this.climb(vertical, code)) return;
    const input = this.keys.get(code);
    if (input?.direction) this.held.set(code, input);
    else if (input) this.downAction(input.action, code);
  }

  downAction(key: string, source: string) {
    if (this.won) return false;
    const animation = this.manifest.actions[key];
    if (!animation || this.held.has(source)) return false;
    if (this.toggled === key) { this.toggled = null; return true; }
    if (this.pressed && !this.manifest.actions[this.pressed].gameplay.interruptible) return false;
    if ((this.cooldowns.get(key) ?? 0) > this.timeMs) return false;
    if (key === "jump" && !this.grounded && !this.climbing) return false;
    if (isAttackAction(key, animation) && !this.items.startAttack(this.timeMs, this.direction)) return false;
    this.cooldowns.set(key, this.timeMs + (animation.gameplay.cooldownMs ?? 0));
    if (this.climbing) {
      this.ladder = null;
      // Jumping or using a move releases the ladder until climb is released.
      this.climbBlocked = this.climbInputs.size > 0;
    }
    if (key === "jump") {
      const gravity = 1400 * (animation.gameplay.gravityScale ?? 1);
      const visibleJumpLimit = Math.sqrt(2 * gravity * Math.max(0, this.y - HERO_HEIGHT));
      this.velocity = -Math.min(Math.abs(animation.gameplay.jumpVelocity ?? 540) * JUMP_POWER_MULTIPLIER, visibleJumpLimit);
      this.pressed = null;
      this.toggled = null;
    } else {
      this.pressed = null;
      if (animation.gameplay.trigger === "hold") this.held.set(source, { action: key });
      else if (animation.gameplay.trigger === "toggle") this.toggled = key;
      else { this.pressed = key; this.toggled = null; }
    }
    this.activate(key, true);
    return true;
  }

  move(direction: "left" | "right", source: string) {
    if (this.won) return;
    this.held.set(source, { action: "walk", direction });
  }

  climb(direction: "up" | "down", source: string) {
    if (this.won) return false;
    this.climbInputs.set(source, direction);
    return this.tryClimb(direction === "up" ? -1 : 1);
  }

  private tryClimb(vertical: number) {
    if (this.ladder) return true;
    if (!vertical || this.climbBlocked || this.manifest.actions[this.action].gameplay.lockMovement || (this.pressed && !this.manifest.actions[this.pressed].gameplay.interruptible) || [...this.held.values()].some(input => input.direction)) return false;
    const ladder = this.world.ladders?.find(value =>
      this.x + HERO_HALF_WIDTH > value.left && this.x - HERO_HALF_WIDTH < value.right &&
      (vertical < 0 ? this.y > value.top && this.y <= value.bottom + 8 : this.y >= value.top && this.y < value.bottom),
    );
    if (!ladder) return false;
    this.ladder = ladder;
    this.x = (ladder.left + ladder.right) / 2;
    this.y = Math.max(ladder.top, Math.min(ladder.bottom, this.y));
    this.velocity = 0;
    this.pressed = null;
    this.toggled = null;
    this.items.cancelAttack();
    for (const source of this.climbInputs.keys()) this.held.delete(source);
    return true;
  }

  up(source: string) {
    this.held.delete(source);
    this.climbInputs.delete(source);
    if (!this.climbInputs.size) this.climbBlocked = false;
  }

  reset() {
    this.held.clear();
    this.climbInputs.clear();
    this.climbBlocked = false;
    this.pressed = null;
    this.toggled = null;
    this.items.cancelAttack();
  }

  private activate(key: string, restart = false) {
    if (this.action !== key || restart) {
      this.action = key;
      this.elapsedMs = 0;
      this.sequence++;
    }
  }

  private interact(nowMs: number, dtMs: number) {
    this.items.step(nowMs, this.x, this.y, this.goblin);
    if (this.won) {
      this.reset();
      this.activate(this.fallback, true);
      return true;
    }
    this.goblin.step(dtMs, this.items.allCoinsCollected, this.body);
    return false;
  }

  step(dtMs: number) {
    if (this.won || !Number.isFinite(dtMs) || dtMs <= 0) return;
    this.timeMs += dtMs;
    if (this.pressed) {
      const total = actionFrames(this.manifest, this.pressed, this.direction).frames.reduce((sum, frame) => sum + frame.durationMs, 0);
      // A press always plays one cycle, even when its saved preview loops.
      if (this.elapsedMs >= total) this.pressed = null;
    }
    const held = [...this.held.values()].reverse();
    const moving = Number(held.some(input => input.direction === "right")) - Number(held.some(input => input.direction === "left"));
    const vertical = Number([...this.climbInputs.values()].includes("down")) - Number([...this.climbInputs.values()].includes("up"));
    if (moving) this.direction = moving < 0 ? "left" : "right";
    if (moving) this.ladder = null;
    else this.tryClimb(vertical);
    const resolve = () => {
      const holding = held.find(input => !input.direction && (input.action !== "crouch" || this.grounded))?.action;
      const wanted = this.climbing ? (vertical ? (this.manifest.actions.climb ? "climb" : "walk") : this.fallback) : this.pressed ?? holding ?? this.toggled ?? (!this.grounded ? "jump" : moving ? "walk" : this.fallback);
      this.activate(this.manifest.actions[wanted] ? wanted : this.fallback);
    };
    resolve();
    // Small physics slices prevent fast falls, dashes and slow render frames
    // from skipping narrow ledges or hazards. Integrate gravity analytically.
    for (let consumed = 0; consumed < dtMs;) {
      const slice = Math.min(1000 / 120, dtMs - consumed), dt = slice / 1000;
      if (this.ladder) {
        const { top, bottom } = this.ladder;
        this.y = Math.max(top, Math.min(bottom, this.y + vertical * CLIMB_SPEED * dt));
        this.velocity = 0;
        // Crossing a ladder endpoint places the feet on its adjoining ledge.
        if ((vertical < 0 && this.y <= top) || (vertical > 0 && this.y >= bottom)) this.ladder = null;
        consumed += slice;
        if (this.interact(this.timeMs - dtMs + consumed, slice)) return;
        continue;
      }
      const gameplay = this.manifest.actions[this.action].gameplay;
      const speed = (this.manifest.actions.walk?.gameplay.moveSpeed ?? 230) * WALK_SPEED_MULTIPLIER * (this.action === "crouch" ? gameplay.crouchSpeedMultiplier ?? 0.4 : 1);
      let dx = gameplay.lockMovement ? 0 : moving * speed * dt, rootY = 0;
      if (gameplay.rootMotion) {
        const root = gameplay.rootMotion, elapsed = this.elapsedMs + consumed;
        const fraction = Math.min(1, (elapsed + slice) / root.overMs) - Math.min(1, elapsed / root.overMs);
        dx += root.dx * fraction * (this.direction === "left" ? -1 : 1);
        rootY = root.dy * fraction;
      }
      const gravity = 1400 * (this.manifest.actions.jump?.gameplay.gravityScale ?? 1);
      const body = moveBody(this.world, this.x, this.y, dx, rootY + this.velocity * dt + 0.5 * gravity * dt * dt, this.grounded, HERO_BODY, this.obstacles);
      this.x = body.x;
      this.y = body.y;
      this.velocity = body.grounded || body.hitCeiling ? 0 : this.velocity + gravity * dt;
      consumed += slice;
      if (this.y - HERO_HEIGHT > this.world.height || this.world.hazards.some(hazard =>
        // Spikes sit on a one-way ledge: passing underneath it is safe.
        this.x + HERO_HALF_WIDTH > hazard.left && this.x - HERO_HALF_WIDTH < hazard.right && this.y > hazard.top && this.y <= hazard.bottom,
      )) {
        this.x = this.world.spawn.x;
        this.y = this.world.spawn.y;
        this.velocity = 0;
        this.ladder = null;
        this.reset();
        this.activate(this.fallback, true);
        this.goblin.step(dtMs - consumed + slice, this.items.allCoinsCollected, this.body);
        return;
      }
      if (this.interact(this.timeMs - dtMs + consumed, slice)) return;
    }
    this.elapsedMs += dtMs;
    resolve();
  }
}
