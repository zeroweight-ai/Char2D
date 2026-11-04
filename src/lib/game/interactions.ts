import type { Manifest, Direction } from "../manifest";
import { HERO_HALF_WIDTH, HERO_HEIGHT, type Coin, type WorldMap } from "./world";
import { GOBLIN_HALF_WIDTH, GOBLIN_HEIGHT, type GoblinSoldier } from "./goblin";

export const ATTACK_DURATION = 280, ATTACK_COOLDOWN = 400, ATTACK_REACH = 150;
export const COIN_RADIUS = 18;
type Effect = { kind: "coin" | "chest"; x: number; y: number; value: number; startedAt: number };

export function isAttackAction(key: string, action: Manifest["actions"][string]) {
  return /(^|_)(attack|slash|punch|kick|strike|fireball|shoot|smash|swing|stab|thrust|hit)(_|$)/i.test(key) ||
    !!action.events?.some(event => /^(attack|hit|damage)$/i.test(event.name));
}

/** Run-local collection and combat state; input resets and respawns retain loot. */
export class WorldInteractions {
  readonly coins = new Map<string, Coin>();
  readonly collectedCoins = new Set<string>();
  readonly destroyedChests = new Set<string>();
  effects: Effect[] = [];
  coinCount = 0;
  nowMs = 0;
  private swing: { startedAt: number; direction: Direction; hit: Set<string> } | null = null;
  private nextAttackAt = 0;

  constructor(readonly world: WorldMap) {
    for (const coin of world.coins ?? []) this.coins.set(coin.id, { ...coin });
  }

  get totalCoins() {
    return (this.world.coins ?? []).reduce((sum, coin) => sum + coin.value, 0) +
      (this.world.chests ?? []).reduce((sum, chest) => sum + chest.coins, 0);
  }

  get allCoinsCollected() {
    return this.totalCoins > 0 && this.coins.size === 0 && this.coinCount >= this.totalCoins &&
      (this.world.chests ?? []).every(chest => this.destroyedChests.has(chest.id));
  }

  get attackProgress() {
    if (!this.swing) return null;
    const progress = (this.nowMs - this.swing.startedAt) / ATTACK_DURATION;
    return progress < 1 ? Math.max(0, progress) : null;
  }

  startAttack(nowMs: number, direction: Direction) {
    if (nowMs < this.nextAttackAt) return false;
    this.nowMs = nowMs;
    this.swing = { startedAt: nowMs, direction, hit: new Set() };
    this.nextAttackAt = nowMs + ATTACK_COOLDOWN;
    return true;
  }

  cancelAttack() { this.swing = null; }

  step(nowMs: number, x: number, y: number, goblin?: GoblinSoldier) {
    this.nowMs = nowMs;
    this.effects = this.effects.filter(effect => nowMs - effect.startedAt < 750);
    const swing = this.swing, age = swing ? nowMs - swing.startedAt : -1;
    if (swing && age >= 60 && age <= 220) {
      const left = swing.direction === "left" ? x - ATTACK_REACH : x;
      const right = swing.direction === "left" ? x : x + ATTACK_REACH;
      if (goblin?.active && !swing.hit.has("goblin-soldier") && right > goblin.x - GOBLIN_HALF_WIDTH && left < goblin.x + GOBLIN_HALF_WIDTH && y > goblin.y - GOBLIN_HEIGHT && y - HERO_HEIGHT < goblin.y) {
        if (goblin.takeHit()) swing.hit.add("goblin-soldier");
      }
      for (const chest of this.world.chests ?? []) {
        if (this.destroyedChests.has(chest.id) || swing.hit.has(chest.id) || right <= chest.left || left >= chest.right || y <= chest.top || y - HERO_HEIGHT >= chest.bottom) continue;
        swing.hit.add(chest.id);
        this.destroyedChests.add(chest.id);
        const center = (chest.left + chest.right) / 2;
        for (let i = 0; i < chest.coins; i++) {
          const coin: Coin = { id: `${chest.id}:loot:${i}`, x: center + (i % 5 - 2) * 18, y: chest.bottom - 24 - Math.floor(i / 5) * 26, value: 1 };
          this.coins.set(coin.id, coin);
        }
        this.effects.push({ kind: "chest", x: center, y: chest.bottom - 32, value: chest.coins, startedAt: nowMs });
      }
    }
    if (swing && age >= ATTACK_DURATION) this.swing = null;
    for (const coin of this.coins.values()) {
      // Circle against the stable character body, including mid-jump pickups.
      const closestX = Math.max(x - HERO_HALF_WIDTH, Math.min(x + HERO_HALF_WIDTH, coin.x));
      const closestY = Math.max(y - HERO_HEIGHT, Math.min(y, coin.y));
      if ((closestX - coin.x) ** 2 + (closestY - coin.y) ** 2 > COIN_RADIUS ** 2) continue;
      this.coins.delete(coin.id);
      this.collectedCoins.add(coin.id);
      this.coinCount += coin.value;
      this.effects.push({ kind: "coin", x: coin.x, y: coin.y, value: coin.value, startedAt: nowMs });
    }
  }
}
