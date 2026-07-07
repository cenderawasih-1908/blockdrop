import { type Cell, PIECES, PIECE_TYPES, type PieceType } from "./pieces";

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;

export type CellValue = PieceType | null;
export type Board = CellValue[][];
export type GameStatus = "ready" | "playing" | "paused" | "gameover";

export type ActivePiece = {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
};

export type ClearEvent = {
  id: number;
  count: number;
  rows: number[];
  isQuad: boolean;
};

export type GameSnapshot = {
  board: Board;
  active: ActivePiece | null;
  activeId: number;
  ghost: ActivePiece | null;
  lastClear: ClearEvent | null;
  nextType: PieceType | null;
  score: number;
  lines: number;
  level: number;
  status: GameStatus;
  version: number;
};

const LINE_SCORES = [0, 100, 300, 500, 800] as const;

const KICKS: readonly Cell[] = [
  { x: 0, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -2, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 }
];

export class BlockDropGame {
  private board: Board = createEmptyBoard();
  private active: ActivePiece | null = null;
  private queue: PieceType[] = [];
  private dropElapsed = 0;
  private score = 0;
  private lines = 0;
  private status: GameStatus = "ready";
  private version = 0;
  private activeId = 0;
  private clearEventId = 0;
  private lastClear: ClearEvent | null = null;

  reset(): void {
    this.board = createEmptyBoard();
    this.queue = [];
    this.dropElapsed = 0;
    this.score = 0;
    this.lines = 0;
    this.status = "ready";
    this.activeId = 0;
    this.clearEventId = 0;
    this.lastClear = null;
    this.refillQueue();
    this.refillQueue();
    this.spawnPiece();
    this.touch();
  }

  start(): void {
    if (this.status === "ready" || this.status === "paused") {
      this.status = "playing";
      this.touch();
    }
  }

  togglePause(): void {
    if (this.status === "playing") {
      this.status = "paused";
      this.touch();
      return;
    }

    if (this.status === "paused") {
      this.status = "playing";
      this.touch();
    }
  }

  step(deltaMs: number): void {
    if (this.status !== "playing") {
      return;
    }

    this.dropElapsed += deltaMs;

    while (this.dropElapsed >= this.dropInterval && this.status === "playing") {
      this.dropElapsed -= this.dropInterval;

      if (!this.tryMove(0, 1)) {
        this.lockPiece();
      }
    }
  }

  moveLeft(): void {
    this.tryMove(-1, 0);
  }

  moveRight(): void {
    this.tryMove(1, 0);
  }

  softDrop(): void {
    if (this.status !== "playing") {
      return;
    }

    if (this.tryMove(0, 1)) {
      this.score += 1;
      this.touch();
      return;
    }

    this.lockPiece();
  }

  hardDrop(): void {
    if (this.status !== "playing" || !this.active) {
      return;
    }

    const ghost = this.getGhostPiece();
    const distance = ghost.y - this.active.y;
    this.active = ghost;
    this.score += distance * 2;
    this.touch();
    this.lockPiece();
  }

  rotate(direction: 1 | -1): void {
    if (this.status !== "playing" || !this.active) {
      return;
    }

    const rotated: ActivePiece = {
      ...this.active,
      rotation: (this.active.rotation + direction + 4) % 4
    };

    for (const kick of KICKS) {
      const candidate = {
        ...rotated,
        x: rotated.x + kick.x,
        y: rotated.y + kick.y
      };

      if (this.canPlace(candidate)) {
        this.active = candidate;
        this.touch();
        return;
      }
    }
  }

  getSnapshot(): GameSnapshot {
    return {
      board: this.board.map((row) => [...row]),
      active: this.active ? { ...this.active } : null,
      activeId: this.active ? this.activeId : 0,
      ghost: this.active ? this.getGhostPiece() : null,
      lastClear: this.lastClear ? { ...this.lastClear, rows: [...this.lastClear.rows] } : null,
      nextType: this.queue[0] ?? null,
      score: this.score,
      lines: this.lines,
      level: this.level,
      status: this.status,
      version: this.version
    };
  }

  private get level(): number {
    return Math.floor(this.lines / 10) + 1;
  }

  private get dropInterval(): number {
    return Math.max(95, 760 - (this.level - 1) * 55);
  }

  private tryMove(dx: number, dy: number): boolean {
    if (this.status !== "playing" || !this.active) {
      return false;
    }

    const candidate = {
      ...this.active,
      x: this.active.x + dx,
      y: this.active.y + dy
    };

    if (!this.canPlace(candidate)) {
      return false;
    }

    this.active = candidate;
    this.touch();
    return true;
  }

  private lockPiece(): void {
    if (!this.active) {
      return;
    }

    const cells = getPieceCells(this.active);
    let lockedAboveBoard = false;

    for (const cell of cells) {
      if (cell.y < 0) {
        lockedAboveBoard = true;
        continue;
      }

      if (cell.y < BOARD_HEIGHT) {
        this.board[cell.y][cell.x] = this.active.type;
      }
    }

    const cleared = this.clearLines();

    if (cleared.count > 0) {
      this.score += LINE_SCORES[cleared.count] * this.level;
      this.lines += cleared.count;
      this.clearEventId += 1;
      this.lastClear = {
        id: this.clearEventId,
        count: cleared.count,
        rows: cleared.rows,
        isQuad: cleared.count >= 4
      };
    }

    if (lockedAboveBoard) {
      this.active = null;
      this.status = "gameover";
      this.touch();
      return;
    }

    this.spawnPiece();
    this.dropElapsed = 0;
    this.touch();
  }

  private spawnPiece(): void {
    while (this.queue.length < PIECE_TYPES.length) {
      this.refillQueue();
    }

    const type = this.queue.shift();

    if (!type) {
      this.active = null;
      this.status = "gameover";
      return;
    }

    const piece: ActivePiece = {
      type,
      rotation: 0,
      x: Math.floor(BOARD_WIDTH / 2) - 2,
      y: -1
    };

    if (!this.canPlace(piece)) {
      this.active = null;
      this.status = "gameover";
      return;
    }

    this.active = piece;
    this.activeId += 1;
  }

  private clearLines(): { count: number; rows: number[] } {
    const rows: number[] = [];
    const remaining: Board = [];

    this.board.forEach((row, y) => {
      if (row.every((cell) => cell !== null)) {
        rows.push(y);
        return;
      }

      remaining.push(row);
    });

    const cleared = rows.length;

    while (remaining.length < BOARD_HEIGHT) {
      remaining.unshift(Array<CellValue>(BOARD_WIDTH).fill(null));
    }

    this.board = remaining;
    return { count: cleared, rows };
  }

  private refillQueue(): void {
    const bag = [...PIECE_TYPES];

    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
    }

    this.queue.push(...bag);
  }

  private getGhostPiece(): ActivePiece {
    if (!this.active) {
      throw new Error("Cannot get a ghost piece without an active piece.");
    }

    const ghost = { ...this.active };

    while (this.canPlace({ ...ghost, y: ghost.y + 1 })) {
      ghost.y += 1;
    }

    return ghost;
  }

  private canPlace(piece: ActivePiece): boolean {
    return getPieceCells(piece).every((cell) => {
      if (cell.x < 0 || cell.x >= BOARD_WIDTH || cell.y >= BOARD_HEIGHT) {
        return false;
      }

      if (cell.y < 0) {
        return true;
      }

      return this.board[cell.y][cell.x] === null;
    });
  }

  private touch(): void {
    this.version += 1;
  }
}

export function getPieceCells(piece: ActivePiece): Cell[] {
  return PIECES[piece.type][piece.rotation].map((cell) => ({
    x: piece.x + cell.x,
    y: piece.y + cell.y
  }));
}

function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<CellValue>(BOARD_WIDTH).fill(null));
}
