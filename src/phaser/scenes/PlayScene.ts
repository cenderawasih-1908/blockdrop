import Phaser from "phaser";
import {
  createDefaultKeyBindings,
  keyBindingsToActionMap,
  normalizeKeyBindings,
  NON_REPEAT_ACTIONS,
  type GameAction,
  type KeyBindings
} from "../../game/input/actions";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BlockDropGame,
  type GameSnapshot,
  getPieceCells
} from "../../game/simulation/blockDropGame";
import { PIECE_META, PIECES, type Cell, type PieceType } from "../../game/simulation/pieces";

const CELL_SIZE = 30;
const BOARD_X = 30;
const BOARD_Y = 30;
const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 660;

const PIECE_COLORS = Object.fromEntries(
  Object.entries(PIECE_META).map(([type, meta]) => [type, Phaser.Display.Color.HexStringToColor(meta.color).color])
) as Record<PieceType, number>;

type VisualPiece = {
  id: number;
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  scale: number;
  glow: number;
};

type BlockFlash = {
  x: number;
  y: number;
  type: PieceType;
  age: number;
  duration: number;
};

type PieceSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  age: number;
  duration: number;
  size: number;
};

type DropTrail = {
  from: Cell[];
  to: Cell[];
  type: PieceType;
  age: number;
  duration: number;
};

type LineSweep = {
  age: number;
  duration: number;
  count: number;
  rows: number[];
  isQuad: boolean;
};

export class PlayScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private sim = new BlockDropGame();
  private lastPublishedVersion = -1;
  private keyToAction = keyBindingsToActionMap(normalizeKeyBindings(window.blockDropKeyBindings ?? createDefaultKeyBindings()));
  private menuOpen = false;
  private nowMs = 0;
  private activeView: VisualPiece | null = null;
  private previousSnapshot: GameSnapshot | null = null;
  private blockFlashes: BlockFlash[] = [];
  private sparks: PieceSpark[] = [];
  private dropTrails: DropTrail[] = [];
  private lineSweeps: LineSweep[] = [];

  private readonly domActionHandler = (event: Event): void => {
    const action = (event as CustomEvent<GameAction>).detail;
    this.performAction(action);
  };

  private readonly startHandler = (): void => {
    this.sim.start();
    this.render();
  };

  private readonly bindingsHandler = (event: Event): void => {
    const bindings = normalizeKeyBindings((event as CustomEvent<KeyBindings>).detail);
    this.keyToAction = keyBindingsToActionMap(bindings);
  };

  private readonly menuStateHandler = (event: Event): void => {
    const open = Boolean((event as CustomEvent<{ open: boolean }>).detail?.open);
    this.menuOpen = open;

    if (open && this.sim.getSnapshot().status === "playing") {
      this.sim.togglePause();
    }

    this.render();
  };

  constructor() {
    super("PlayScene");
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.sim.reset();

    this.input.keyboard?.on("keydown", this.handleKeyboard, this);
    window.addEventListener("blockdrop:action", this.domActionHandler);
    window.addEventListener("blockdrop:start", this.startHandler);
    window.addEventListener("blockdrop:bindings", this.bindingsHandler);
    window.addEventListener("blockdrop:menu-state", this.menuStateHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("blockdrop:action", this.domActionHandler);
      window.removeEventListener("blockdrop:start", this.startHandler);
      window.removeEventListener("blockdrop:bindings", this.bindingsHandler);
      window.removeEventListener("blockdrop:menu-state", this.menuStateHandler);
    });

    this.render();
  }

  update(time: number, delta: number): void {
    this.nowMs = time;
    this.sim.step(delta);
    this.stepVisuals(delta);
    this.stepEffects(delta);
    this.render();
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (this.menuOpen) {
      return;
    }

    const action = this.keyToAction[event.code];

    if (!action) {
      return;
    }

    event.preventDefault();

    if (event.repeat && NON_REPEAT_ACTIONS.has(action)) {
      return;
    }

    this.performAction(action);
  }

  private performAction(action: GameAction): void {
    const before = this.sim.getSnapshot();

    switch (action) {
      case "move-left":
        this.sim.moveLeft();
        this.bumpActiveGlow(0.25);
        break;
      case "move-right":
        this.sim.moveRight();
        this.bumpActiveGlow(0.25);
        break;
      case "soft-drop":
        this.sim.softDrop();
        break;
      case "hard-drop":
        this.sim.hardDrop();
        this.addHardDropTrail(before);
        break;
      case "rotate-cw":
        this.sim.rotate(1);
        this.bumpActiveGlow(0.9);
        break;
      case "rotate-ccw":
        this.sim.rotate(-1);
        this.bumpActiveGlow(0.9);
        break;
      case "pause":
        this.sim.togglePause();
        break;
      case "restart":
        this.sim.reset();
        this.sim.start();
        this.activeView = null;
        this.previousSnapshot = null;
        this.blockFlashes = [];
        this.sparks = [];
        this.dropTrails = [];
        this.lineSweeps = [];
        break;
    }

    this.render();
  }

  private render(): void {
    const snapshot = this.sim.getSnapshot();

    this.syncActiveView(snapshot);
    this.detectSnapshotEffects(snapshot);

    this.graphics.clear();
    this.drawSceneBase();
    this.drawLockedBlocks(snapshot);
    this.drawDropTrails();
    this.drawLineSweeps();
    this.drawBlockFlashes();
    this.drawGhost(snapshot);
    this.drawActivePiece(snapshot);
    this.drawSparks();
    this.drawFrame();
    this.publishSnapshot(snapshot);
    this.previousSnapshot = snapshot;
  }

  private stepVisuals(delta: number): void {
    if (!this.activeView) {
      return;
    }

    const ease = 1 - Math.pow(0.001, delta / 135);
    this.activeView.x += (this.activeView.targetX - this.activeView.x) * ease;
    this.activeView.y += (this.activeView.targetY - this.activeView.y) * ease;
    this.activeView.scale += (1 - this.activeView.scale) * ease;
    this.activeView.glow = Math.max(0, this.activeView.glow - delta / 260);
  }

  private stepEffects(delta: number): void {
    for (const flash of this.blockFlashes) {
      flash.age += delta;
    }

    for (const trail of this.dropTrails) {
      trail.age += delta;
    }

    for (const sweep of this.lineSweeps) {
      sweep.age += delta;
    }

    for (const spark of this.sparks) {
      spark.age += delta;
      spark.vy += 0.00016 * delta;
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
    }

    this.blockFlashes = this.blockFlashes.filter((flash) => flash.age < flash.duration);
    this.dropTrails = this.dropTrails.filter((trail) => trail.age < trail.duration);
    this.lineSweeps = this.lineSweeps.filter((sweep) => sweep.age < sweep.duration);
    this.sparks = this.sparks.filter((spark) => spark.age < spark.duration);
  }

  private syncActiveView(snapshot: GameSnapshot): void {
    if (!snapshot.active) {
      this.activeView = null;
      return;
    }

    const active = snapshot.active;

    if (!this.activeView || this.activeView.id !== snapshot.activeId) {
      this.activeView = {
        id: snapshot.activeId,
        type: active.type,
        rotation: active.rotation,
        x: active.x,
        y: active.y - 1.35,
        targetX: active.x,
        targetY: active.y,
        scale: 0.82,
        glow: 1.15
      };
      return;
    }

    if (this.activeView.rotation !== active.rotation) {
      this.activeView.scale = Math.max(this.activeView.scale, 1.08);
      this.activeView.glow = Math.max(this.activeView.glow, 0.9);
    }

    this.activeView.type = active.type;
    this.activeView.rotation = active.rotation;
    this.activeView.targetX = active.x;
    this.activeView.targetY = active.y;
  }

  private detectSnapshotEffects(snapshot: GameSnapshot): void {
    const previous = this.previousSnapshot;

    if (!previous || previous.version === snapshot.version) {
      return;
    }

    const clear = snapshot.lastClear;

    if (clear && previous.lastClear?.id !== clear.id) {
      this.lineSweeps.push({
        age: 0,
        duration: clear.isQuad ? 920 : 620,
        count: clear.count,
        rows: clear.rows,
        isQuad: clear.isQuad
      });
      this.emitClearSparks(clear.rows, clear.isQuad);
      window.dispatchEvent(new CustomEvent("blockdrop:clear", { detail: clear }));
      this.cameras.main.shake(clear.isQuad ? 280 : 150, clear.isQuad ? 0.008 : 0.004);
      return;
    }

    const newCells: Array<{ x: number; y: number; type: PieceType }> = [];

    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const currentType = snapshot.board[y][x];

        if (currentType && previous.board[y][x] !== currentType) {
          newCells.push({ x, y, type: currentType });
        }
      }
    }

    if (newCells.length === 0) {
      return;
    }

    for (const cell of newCells) {
      this.blockFlashes.push({ ...cell, age: 0, duration: 280 });
    }

    this.emitSparks(newCells, 3);
    this.cameras.main.shake(70, 0.0018);
  }

  private addHardDropTrail(snapshot: GameSnapshot): void {
    if (!snapshot.active || !snapshot.ghost) {
      return;
    }

    this.dropTrails.push({
      from: getPieceCells(snapshot.active),
      to: getPieceCells(snapshot.ghost),
      type: snapshot.active.type,
      age: 0,
      duration: 300
    });
    this.cameras.main.shake(95, 0.003);
  }

  private emitSparks(cells: Array<{ x: number; y: number; type: PieceType }>, countPerCell: number): void {
    for (const cell of cells) {
      for (let index = 0; index < countPerCell; index += 1) {
        this.sparks.push({
          x: BOARD_X + (cell.x + 0.5) * CELL_SIZE,
          y: BOARD_Y + (cell.y + 0.5) * CELL_SIZE,
          vx: Phaser.Math.FloatBetween(-0.045, 0.045),
          vy: Phaser.Math.FloatBetween(-0.085, 0.02),
          color: shiftColor(PIECE_COLORS[cell.type], 44),
          age: 0,
          duration: Phaser.Math.Between(280, 520),
          size: Phaser.Math.FloatBetween(1.8, 3.4)
        });
      }
    }
  }

  private emitClearSparks(rows: number[], isQuad: boolean): void {
    const colors = [0xf6d84d, 0x25c7e8, 0x4bd178, 0xff7f5f, 0xf25b72, 0xb66dff];
    const density = isQuad ? 4 : 2;

    for (const row of rows) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        for (let index = 0; index < density; index += 1) {
          this.sparks.push({
            x: BOARD_X + (x + Phaser.Math.FloatBetween(0.18, 0.82)) * CELL_SIZE,
            y: BOARD_Y + (row + Phaser.Math.FloatBetween(0.2, 0.8)) * CELL_SIZE,
            vx: Phaser.Math.FloatBetween(-0.12, 0.12),
            vy: Phaser.Math.FloatBetween(isQuad ? -0.18 : -0.1, 0.055),
            color: colors[Phaser.Math.Between(0, colors.length - 1)],
            age: 0,
            duration: Phaser.Math.Between(isQuad ? 680 : 420, isQuad ? 1120 : 720),
            size: Phaser.Math.FloatBetween(isQuad ? 2.3 : 1.8, isQuad ? 4.6 : 3.4)
          });
        }
      }
    }
  }

  private bumpActiveGlow(amount: number): void {
    if (!this.activeView) {
      return;
    }

    this.activeView.glow = Math.max(this.activeView.glow, amount);
  }

  private drawSceneBase(): void {
    const g = this.graphics;
    const width = BOARD_WIDTH * CELL_SIZE;
    const height = BOARD_HEIGHT * CELL_SIZE;

    g.fillStyle(0x101216, 1);
    g.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    g.fillStyle(0x151b23, 1);
    g.fillRoundedRect(BOARD_X - 8, BOARD_Y - 8, width + 16, height + 16, 8);

    g.fillStyle(0x0b0f16, 1);
    g.fillRect(BOARD_X, BOARD_Y, width, height);
    this.drawAmbientDust();

    g.lineStyle(1, 0x243141, 0.48);

    for (let x = 0; x <= BOARD_WIDTH; x += 1) {
      const px = BOARD_X + x * CELL_SIZE;
      g.lineBetween(px, BOARD_Y, px, BOARD_Y + height);
    }

    for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
      const py = BOARD_Y + y * CELL_SIZE;
      g.lineBetween(BOARD_X, py, BOARD_X + width, py);
    }
  }

  private drawAmbientDust(): void {
    const g = this.graphics;
    const width = BOARD_WIDTH * CELL_SIZE;
    const height = BOARD_HEIGHT * CELL_SIZE;

    for (let index = 0; index < 18; index += 1) {
      const x = BOARD_X + ((index * 47 + this.nowMs * 0.009) % width);
      const y = BOARD_Y + ((index * 71 + this.nowMs * 0.018) % height);
      const alpha = 0.035 + Math.sin(this.nowMs / 320 + index) * 0.018;
      g.fillStyle(index % 2 === 0 ? 0x25c7e8 : 0xf6d84d, Math.max(0.012, alpha));
      g.fillCircle(x, y, index % 3 === 0 ? 1.5 : 1);
    }
  }

  private drawLockedBlocks(snapshot: GameSnapshot): void {
    snapshot.board.forEach((row, y) => {
      row.forEach((type, x) => {
        if (type) {
          this.drawBlock(x, y, type, 1);
        }
      });
    });
  }

  private drawDropTrails(): void {
    const g = this.graphics;

    for (const trail of this.dropTrails) {
      const progress = trail.age / trail.duration;
      const alpha = (1 - progress) * 0.56;
      const color = PIECE_COLORS[trail.type];

      for (let index = 0; index < trail.to.length; index += 1) {
        const from = trail.from[index];
        const to = trail.to[index];

        if (!from || !to || to.y < 0) {
          continue;
        }

        const x = BOARD_X + (to.x + 0.5) * CELL_SIZE;
        const fromY = BOARD_Y + Math.max(from.y + 0.5, 0) * CELL_SIZE;
        const toY = BOARD_Y + (to.y + 0.5) * CELL_SIZE;

        g.lineStyle(5, color, alpha * 0.46);
        g.lineBetween(x, fromY, x, toY);
        g.lineStyle(1, shiftColor(color, 65), alpha);
        g.lineBetween(x, fromY, x, toY);
      }
    }
  }

  private drawLineSweeps(): void {
    const g = this.graphics;
    const width = BOARD_WIDTH * CELL_SIZE;
    const height = BOARD_HEIGHT * CELL_SIZE;

    for (const sweep of this.lineSweeps) {
      const progress = Phaser.Math.Clamp(sweep.age / sweep.duration, 0, 1);
      const alpha = Math.sin(progress * Math.PI);

      for (const row of sweep.rows) {
        const rowY = BOARD_Y + row * CELL_SIZE;
        const beamWidth = width * Phaser.Math.Clamp(progress * 1.45, 0.08, 1);
        const beamX = BOARD_X + (width - beamWidth) / 2;
        const warmAlpha = alpha * (sweep.isQuad ? 0.36 : 0.24);

        g.fillStyle(sweep.isQuad ? 0xf6d84d : 0x25c7e8, warmAlpha * 0.34);
        g.fillRoundedRect(BOARD_X + 2, rowY + 2, width - 4, CELL_SIZE - 4, 5);

        g.fillStyle(0xffffff, alpha * 0.72);
        g.fillRoundedRect(beamX, rowY + 10, beamWidth, 10, 5);

        g.lineStyle(sweep.isQuad ? 4 : 3, sweep.isQuad ? 0xf6d84d : 0x25c7e8, alpha * 0.88);
        g.lineBetween(BOARD_X + 6, rowY + CELL_SIZE / 2, BOARD_X + width - 6, rowY + CELL_SIZE / 2);
      }

      if (sweep.isQuad) {
        const centerX = BOARD_X + width / 2;
        const centerY = BOARD_Y + height / 2;
        const ringRadius = 34 + progress * 210;
        const reverseRadius = 210 - progress * 120;

        g.fillStyle(0xf6d84d, alpha * 0.08);
        g.fillRect(BOARD_X, BOARD_Y, width, height);
        g.lineStyle(5, 0xf6d84d, alpha * 0.58);
        g.strokeCircle(centerX, centerY, ringRadius);
        g.lineStyle(2, 0x25c7e8, alpha * 0.6);
        g.strokeCircle(centerX, centerY, reverseRadius);

        for (let index = 0; index < 12; index += 1) {
          const angle = (Math.PI * 2 * index) / 12 + progress * 1.2;
          const inner = 40 + progress * 24;
          const outer = 112 + progress * 96;
          g.lineStyle(2, index % 2 === 0 ? 0xf6d84d : 0x4bd178, alpha * 0.52);
          g.lineBetween(
            centerX + Math.cos(angle) * inner,
            centerY + Math.sin(angle) * inner,
            centerX + Math.cos(angle) * outer,
            centerY + Math.sin(angle) * outer
          );
        }
      }
    }
  }

  private drawBlockFlashes(): void {
    const g = this.graphics;

    for (const flash of this.blockFlashes) {
      const progress = Phaser.Math.Clamp(flash.age / flash.duration, 0, 1);
      const alpha = (1 - progress) * 0.52;
      const size = CELL_SIZE * (0.72 + progress * 0.88);
      const x = BOARD_X + (flash.x + 0.5) * CELL_SIZE - size / 2;
      const y = BOARD_Y + (flash.y + 0.5) * CELL_SIZE - size / 2;

      g.lineStyle(2, shiftColor(PIECE_COLORS[flash.type], 58), alpha);
      g.strokeRoundedRect(x, y, size, size, 6);
    }
  }

  private drawGhost(snapshot: GameSnapshot): void {
    if (!snapshot.ghost || !snapshot.active) {
      return;
    }

    getPieceCells(snapshot.ghost).forEach((cell) => {
      if (cell.y >= 0) {
        this.drawGhostCell(cell.x, cell.y, snapshot.active?.type ?? "I");
      }
    });
  }

  private drawActivePiece(snapshot: GameSnapshot): void {
    if (!snapshot.active) {
      return;
    }

    const view = this.activeView;

    if (!view || view.id !== snapshot.activeId) {
      getPieceCells(snapshot.active).forEach((cell) => {
        if (cell.y >= 0) {
          this.drawBlock(cell.x, cell.y, snapshot.active?.type ?? "I", 1);
        }
      });
      return;
    }

    const pulse = 1 + Math.sin(this.nowMs / 115) * 0.012 + view.glow * 0.035;

    PIECES[view.type][view.rotation].forEach((cell) => {
      const x = view.x + cell.x;
      const y = view.y + cell.y;

      if (y >= -0.9) {
        this.drawBlock(x, y, view.type, 1, pulse * view.scale, view.glow);
      }
    });
  }

  private drawSparks(): void {
    const g = this.graphics;

    for (const spark of this.sparks) {
      const progress = Phaser.Math.Clamp(spark.age / spark.duration, 0, 1);
      const alpha = (1 - progress) * 0.78;

      g.fillStyle(spark.color, alpha);
      g.fillCircle(spark.x, spark.y, spark.size * (1 - progress * 0.35));
    }
  }

  private drawFrame(): void {
    const g = this.graphics;
    const width = BOARD_WIDTH * CELL_SIZE;
    const height = BOARD_HEIGHT * CELL_SIZE;
    const sweepGlow = this.lineSweeps.length > 0 ? 0.18 : 0;

    g.lineStyle(3, 0xf7efe0, 0.84 + sweepGlow);
    g.strokeRoundedRect(BOARD_X - 1, BOARD_Y - 1, width + 2, height + 2, 5);
    g.lineStyle(1, 0xff7f5f, 0.55 + sweepGlow);
    g.strokeRoundedRect(BOARD_X - 7, BOARD_Y - 7, width + 14, height + 14, 8);
  }

  private drawBlock(x: number, y: number, type: PieceType, alpha: number, scale = 1, glow = 0): void {
    const g = this.graphics;
    const px = BOARD_X + x * CELL_SIZE;
    const py = BOARD_Y + y * CELL_SIZE;
    const color = PIECE_COLORS[type];
    const highlight = shiftColor(color, 42);
    const shade = shiftColor(color, -58);
    const baseSize = CELL_SIZE - 4;
    const size = baseSize * scale;
    const blockX = px + CELL_SIZE / 2 - size / 2;
    const blockY = py + CELL_SIZE / 2 - size / 2;

    if (glow > 0) {
      g.fillStyle(highlight, Math.min(0.22, glow * 0.13) * alpha);
      g.fillRoundedRect(blockX - 4, blockY - 4, size + 8, size + 8, 7);
    }

    g.fillStyle(color, alpha);
    g.fillRoundedRect(blockX, blockY, size, size, 5);

    g.fillStyle(highlight, alpha * 0.72);
    g.fillRoundedRect(blockX + 3, blockY + 4, Math.max(4, size - 9), 6, 3);

    g.lineStyle(2, highlight, alpha * 0.72);
    g.lineBetween(blockX + 4, blockY + 3, blockX + size - 5, blockY + 3);
    g.lineBetween(blockX + 3, blockY + 4, blockX + 3, blockY + size - 5);

    g.lineStyle(2, shade, alpha * 0.8);
    g.lineBetween(blockX + 4, blockY + size - 3, blockX + size - 5, blockY + size - 3);
    g.lineBetween(blockX + size - 3, blockY + 4, blockX + size - 3, blockY + size - 5);
  }

  private drawGhostCell(x: number, y: number, type: PieceType): void {
    const g = this.graphics;
    const px = BOARD_X + x * CELL_SIZE;
    const py = BOARD_Y + y * CELL_SIZE;
    const color = PIECE_COLORS[type];
    const pulse = 0.38 + Math.sin(this.nowMs / 190) * 0.08;

    g.fillStyle(color, 0.08 + pulse * 0.08);
    g.fillRoundedRect(px + 4, py + 4, CELL_SIZE - 8, CELL_SIZE - 8, 5);
    g.lineStyle(2, color, pulse);
    g.strokeRoundedRect(px + 5, py + 5, CELL_SIZE - 10, CELL_SIZE - 10, 4);
  }

  private publishSnapshot(snapshot: GameSnapshot): void {
    if (snapshot.version === this.lastPublishedVersion) {
      return;
    }

    this.lastPublishedVersion = snapshot.version;
    window.dispatchEvent(new CustomEvent<GameSnapshot>("blockdrop:state", { detail: snapshot }));
  }
}

function shiftColor(color: number, amount: number): number {
  const red = clamp(((color >> 16) & 0xff) + amount);
  const green = clamp(((color >> 8) & 0xff) + amount);
  const blue = clamp((color & 0xff) + amount);

  return (red << 16) + (green << 8) + blue;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}
