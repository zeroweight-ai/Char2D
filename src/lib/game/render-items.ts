import type { WorldInteractions } from "./interactions";
import type { TreasureChest } from "./world";

// The village backdrop has no baked-in collectibles. Draw interactive props on
// their own layer so collecting coins and breaking chests reveals clean scenery.
function drawChest(context: CanvasRenderingContext2D, chest: TreasureChest) {
  context.save();
  context.translate(chest.left, chest.top);
  context.scale((chest.right - chest.left) / 104, (chest.bottom - chest.top) / 64);
  context.fillStyle = "#281c2b";
  context.fillRect(0, 24, 104, 36); context.fillRect(4, 12, 96, 48);
  context.fillRect(12, 4, 80, 56); context.fillRect(20, 0, 64, 12);
  context.fillStyle = "#aa552c"; context.fillRect(4, 34, 96, 26);
  context.fillStyle = "#d9823c"; context.fillRect(8, 16, 88, 14); context.fillRect(16, 8, 72, 20);
  context.fillStyle = "#f0b36a"; context.fillRect(20, 5, 60, 4); context.fillRect(8, 18, 4, 10);
  context.fillStyle = "#713922"; context.fillRect(8, 44, 88, 3); context.fillRect(8, 55, 88, 3);
  for (const x of [16, 78]) {
    context.fillStyle = "#281c2b"; context.fillRect(x, 7, 14, 53);
    context.fillStyle = "#efab2b"; context.fillRect(x + 3, 9, 8, 49);
    context.fillStyle = "#ffe377"; context.fillRect(x + 3, 9, 3, 45);
  }
  context.fillStyle = "#281c2b"; context.fillRect(0, 27, 104, 13);
  context.fillStyle = "#f1b329"; context.fillRect(3, 30, 98, 7);
  context.fillStyle = "#fff0a0"; context.fillRect(5, 30, 94, 2);
  context.fillStyle = "#281c2b"; context.fillRect(39, 29, 26, 25);
  context.fillStyle = "#f8cb43"; context.fillRect(43, 32, 18, 18);
  context.fillStyle = "#fff0a0"; context.fillRect(43, 32, 18, 3);
  context.fillStyle = "#281c2b"; context.fillRect(49, 37, 6, 5); context.fillRect(51, 40, 3, 7);
  context.restore();
}

function drawRubble(context: CanvasRenderingContext2D, x: number, y: number) {
  context.save();
  context.translate(x, y - 8);
  for (let i = 0; i < 3; i++) {
    context.save();
    context.translate((i - 1) * 24, -i % 2 * 7);
    context.rotate((i - 1) * 0.22);
    context.fillStyle = "#2d1b29"; context.fillRect(-19, -5, 38, 12);
    context.fillStyle = "#ad6339"; context.fillRect(-16, -2, 32, 6);
    context.fillStyle = "#efb26a"; context.fillRect(-14, -2, 27, 2);
    context.fillStyle = "#ffc83c"; context.fillRect(7, -2, 4, 6);
    context.restore();
  }
  context.restore();
}

function drawCoin(context: CanvasRenderingContext2D, x: number, y: number) {
  context.save();
  context.translate(Math.round(x), Math.round(y));
  context.fillStyle = "#241b2b";
  context.beginPath();
  context.moveTo(-6, -13); context.lineTo(6, -13); context.lineTo(11, -7); context.lineTo(11, 7);
  context.lineTo(6, 13); context.lineTo(-6, 13); context.lineTo(-11, 7); context.lineTo(-11, -7); context.closePath(); context.fill();
  context.fillStyle = "#f99522"; context.fillRect(-7, -8, 14, 16);
  context.fillStyle = "#ffd438"; context.fillRect(-5, -10, 10, 20);
  context.fillStyle = "#fff5aa"; context.fillRect(-4, -8, 3, 12);
  context.restore();
}

export function drawWorldItems(context: CanvasRenderingContext2D, items: WorldInteractions) {
  context.clearRect(0, 0, items.world.width, items.world.height);
  context.imageSmoothingEnabled = false;
  for (const chest of items.world.chests ?? []) {
    if (items.destroyedChests.has(chest.id)) drawRubble(context, (chest.left + chest.right) / 2, chest.bottom);
    else drawChest(context, chest);
  }
  for (const coin of items.coins.values()) {
    drawCoin(context, coin.x, coin.y + Math.sin(items.nowMs / 180 + coin.x) * 2);
  }
  for (const effect of items.effects) {
    const progress = (items.nowMs - effect.startedAt) / 750;
    context.save();
    context.globalAlpha = 1 - progress;
    if (effect.kind === "chest") {
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        context.fillStyle = i % 2 ? "#f7c73c" : "#a75a2c";
        context.fillRect(effect.x + Math.cos(angle) * progress * 90, effect.y + Math.sin(angle) * progress * 70 + progress * progress * 40, 8, 8);
      }
    } else {
      context.font = "bold 22px monospace";
      context.textAlign = "center";
      context.lineWidth = 4;
      context.strokeStyle = "#342038";
      context.strokeText(`+${effect.value}`, effect.x, effect.y - progress * 52);
      context.fillStyle = "#ffe767";
      context.fillText(`+${effect.value}`, effect.x, effect.y - progress * 52);
    }
    context.restore();
  }
}

