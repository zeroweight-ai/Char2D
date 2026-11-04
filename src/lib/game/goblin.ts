import { moveBody, supportAt, type Platform, type WorldMap } from "./world";

export const GOBLIN_HEIGHT = 260, GOBLIN_WALK_SPEED = 140;
export const GOBLIN_MAX_HEALTH = 3, GOBLIN_HALF_WIDTH = 48;
const GOBLIN_BODY = { halfWidth: GOBLIN_HALF_WIDTH, height: GOBLIN_HEIGHT };
const EDGE_MARGIN = 180;

/** One entrance per run after every map coin and treasure coin is collected. */
export class GoblinSoldier {
  spawned = false;
  active = false;
  x: number;
  y: number;
  elapsedMs = 0;
  health = GOBLIN_MAX_HEALTH;
  hurtTimeMs = 0;
  private velocity = 0;
  private readonly exitGround: number;
  private readonly collisionWorld: WorldMap;

  constructor(readonly world: WorldMap) {
    const roadAt = (x: number) => Math.max(world.spawn.y, ...world.platforms.filter(platform => platform.left <= x && platform.right >= x).map(platform => platform.top));
    const entryGround = roadAt(world.width - 1);
    this.exitGround = roadAt(1);
    this.x = world.width + EDGE_MARGIN;
    this.y = entryGround;
    this.collisionWorld = { ...world, width: world.width + EDGE_MARGIN * 2,
      platforms: [...world.platforms, { id: "goblin-entry", left: world.width, right: world.width + EDGE_MARGIN * 2, top: entryGround }] };
  }

  get defeated() { return this.health === 0; }
  get arrived() { return this.x <= EDGE_MARGIN; }
  get body(): Platform {
    return { id: "goblin-body", left: this.x - GOBLIN_HALF_WIDTH, right: this.x + GOBLIN_HALF_WIDTH, top: this.y - GOBLIN_HEIGHT, bottom: this.y };
  }

  takeHit() {
    if (!this.active || this.defeated) return false;
    this.health--;
    this.hurtTimeMs = 300;
    if (this.defeated) this.active = false;
    return true;
  }

  step(dtMs: number, allCoinsCollected: boolean, hero?: Platform) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    if (!this.spawned && allCoinsCollected) {
      this.spawned = true;
      this.active = true;
      return;
    }
    if (!this.active) return;
    const walkingMs = Math.max(0, dtMs - this.hurtTimeMs);
    this.hurtTimeMs = Math.max(0, this.hurtTimeMs - dtMs);
    if (this.arrived) return;
    const obstacles = hero ? [hero] : [];
    let consumed = 0;
    while (consumed < walkingMs) {
      const slice = Math.min(1000 / 120, walkingMs - consumed), dt = slice / 1000;
      const grounded = this.velocity === 0 && !!supportAt(this.collisionWorld, this.x, this.y, GOBLIN_BODY, obstacles);
      const body = moveBody(this.collisionWorld, this.x, this.y, -GOBLIN_WALK_SPEED * dt, this.velocity * dt + 700 * dt * dt, grounded, GOBLIN_BODY, obstacles);
      if (Math.abs(body.x - this.x) > 0.001 || Math.abs(body.y - this.y) > 0.001) this.elapsedMs += slice;
      this.x = body.x;
      this.y = body.y;
      this.velocity = body.grounded || body.hitCeiling ? 0 : this.velocity + 1400 * dt;
      consumed += slice;
      if (this.arrived) { this.x = EDGE_MARGIN; this.y = this.exitGround; break; }
    }
  }
}
