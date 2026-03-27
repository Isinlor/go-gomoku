export const EMPTY = 0 as const;
export const BLACK = 1 as const;
export const WHITE = 2 as const;

export type Cell = 0 | 1 | 2;
export type Player = 1 | 2;
export type SupportedSize = 9 | 11 | 13;

export interface PositionOptions {
  historyCapacity?: number;
  captureCapacity?: number;
}

export interface BoardMeta {
  readonly size: SupportedSize;
  readonly area: number;
  readonly neighbors4: Int16Array;
  readonly xs: Uint8Array;
  readonly ys: Uint8Array;
  readonly near2Offsets: Uint16Array;
  readonly near2: Int16Array;
  readonly windows: Int16Array;
  readonly windowCount: number;
  readonly windowsByPointOffsets: Uint16Array;
  readonly windowsByPoint: Int16Array;
  readonly centerBias: Int16Array;
  readonly zobristStoneHi: Int32Array;
  readonly zobristStoneLo: Int32Array;
  readonly zobristWhiteToMoveHi: number;
  readonly zobristWhiteToMoveLo: number;
  readonly zobristKoHi: Int32Array;
  readonly zobristKoLo: Int32Array;
}

const SUPPORTED_SIZES = new Set<number>([9, 11, 13]);
const META_CACHE = new Map<number, BoardMeta>();

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

function nextRand32(state: Uint32Array): number {
  let x = state[0];
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state[0] = x;
  return x | 0;
}

function createBoardMeta(size: SupportedSize): BoardMeta {
  const area = size * size;
  const neighbors4 = new Int16Array(area * 4);
  neighbors4.fill(-1);
  const xs = new Uint8Array(area);
  const ys = new Uint8Array(area);
  const centerBias = new Int16Array(area);
  const center = (size - 1) >> 1;

  const near2Buckets: number[][] = Array.from({ length: area }, () => []);
  const windowsBucket: number[][] = Array.from({ length: area }, () => []);
  const windows: number[] = [];
  let windowCount = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      xs[index] = x;
      ys[index] = y;
      neighbors4[index * 4] = x > 0 ? index - 1 : -1;
      neighbors4[index * 4 + 1] = x + 1 < size ? index + 1 : -1;
      neighbors4[index * 4 + 2] = y > 0 ? index - size : -1;
      neighbors4[index * 4 + 3] = y + 1 < size ? index + size : -1;
      const manhattan = Math.abs(x - center) + Math.abs(y - center);
      centerBias[index] = size - manhattan;

      for (let ny = Math.max(0, y - 2); ny <= Math.min(size - 1, y + 2); ny += 1) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(size - 1, x + 2); nx += 1) {
          if (nx !== x || ny !== y) {
            near2Buckets[index].push(ny * size + nx);
          }
        }
      }
    }
  }

  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (let dir = 0; dir < directions.length; dir += 1) {
        const dx = directions[dir][0];
        const dy = directions[dir][1];
        const endX = x + dx * 4;
        const endY = y + dy * 4;
        if (endX < 0 || endX >= size || endY < 0 || endY >= size) {
          continue;
        }
        const windowIndex = windowCount;
        for (let step = 0; step < 5; step += 1) {
          const point = (y + dy * step) * size + (x + dx * step);
          windows.push(point);
          windowsBucket[point].push(windowIndex);
        }
        windowCount += 1;
      }
    }
  }

  let near2Total = 0;
  let windowsByPointTotal = 0;
  const near2Offsets = new Uint16Array(area + 1);
  const windowsByPointOffsets = new Uint16Array(area + 1);
  for (let i = 0; i < area; i += 1) {
    near2Offsets[i] = near2Total;
    windowsByPointOffsets[i] = windowsByPointTotal;
    near2Total += near2Buckets[i].length;
    windowsByPointTotal += windowsBucket[i].length;
  }
  near2Offsets[area] = near2Total;
  windowsByPointOffsets[area] = windowsByPointTotal;

  const near2 = new Int16Array(near2Total);
  const windowsByPoint = new Int16Array(windowsByPointTotal);
  for (let i = 0; i < area; i += 1) {
    near2.set(near2Buckets[i], near2Offsets[i]);
    windowsByPoint.set(windowsBucket[i], windowsByPointOffsets[i]);
  }

  // Zobrist hashing: deterministic keys seeded by board size
  const randState = new Uint32Array([((size * 0x9E3779B9) | 1) >>> 0]);
  const zobristStoneHi = new Int32Array(area * 2);
  const zobristStoneLo = new Int32Array(area * 2);
  for (let i = 0; i < area * 2; i += 1) {
    zobristStoneHi[i] = nextRand32(randState);
    zobristStoneLo[i] = nextRand32(randState);
  }
  const zobristWhiteToMoveHi = nextRand32(randState);
  const zobristWhiteToMoveLo = nextRand32(randState);
  const zobristKoHi = new Int32Array(area);
  const zobristKoLo = new Int32Array(area);
  for (let i = 0; i < area; i += 1) {
    zobristKoHi[i] = nextRand32(randState);
    zobristKoLo[i] = nextRand32(randState);
  }

  return {
    size,
    area,
    neighbors4,
    xs,
    ys,
    near2Offsets,
    near2,
    windows: Int16Array.from(windows),
    windowCount,
    windowsByPointOffsets,
    windowsByPoint,
    centerBias,
    zobristStoneHi,
    zobristStoneLo,
    zobristWhiteToMoveHi,
    zobristWhiteToMoveLo,
    zobristKoHi,
    zobristKoLo,
  };
}

function getBoardMeta(size: SupportedSize): BoardMeta {
  const cached = META_CACHE.get(size);
  if (cached !== undefined) {
    return cached;
  }
  const created = createBoardMeta(size);
  META_CACHE.set(size, created);
  return created;
}

function growInt16Array(current: Int16Array, minimumLength: number): Int16Array {
  let nextLength = current.length === 0 ? 4 : current.length;
  while (nextLength < minimumLength) {
    nextLength <<= 1;
  }
  const next = new Int16Array(nextLength);
  next.set(current);
  return next;
}

function growUint8Array(current: Uint8Array, minimumLength: number): Uint8Array {
  let nextLength = current.length === 0 ? 4 : current.length;
  while (nextLength < minimumLength) {
    nextLength <<= 1;
  }
  const next = new Uint8Array(nextLength);
  next.set(current);
  return next;
}

function growInt32Array(current: Int32Array, minimumLength: number): Int32Array {
  let nextLength = current.length === 0 ? 4 : current.length;
  while (nextLength < minimumLength) {
    nextLength <<= 1;
  }
  const next = new Int32Array(nextLength);
  next.set(current);
  return next;
}

export class GogoPosition {
  readonly size: SupportedSize;
  readonly area: number;
  readonly board: Uint8Array;
  readonly meta: BoardMeta;

  toMove: Player = BLACK;
  winner: Cell = EMPTY;
  koPoint = -1;
  ply = 0;
  stoneCount = 0;
  lastMove = -1;
  lastCapturedCount = 0;
  zobristHi = 0;
  zobristLo = 0;

  private historyMoves: Int16Array;
  private historyPlayers: Uint8Array;
  private historyKo: Int16Array;
  private historyWinner: Uint8Array;
  private historyCaptureStart: Int32Array;
  private historyCaptureCount: Int16Array;
  private historyZobristHi: Int32Array;
  private historyZobristLo: Int32Array;
  private capturePositions: Int16Array;
  private captureTop = 0;

  private readonly groupVisitMarks: Uint32Array;
  private readonly libertyMarks: Uint32Array;
  private readonly adjacentGroupMarks: Uint32Array;
  private readonly groupStack: Int16Array;
  readonly groupBuffer: Int16Array;
  private groupVisitEpoch = 1;
  private libertyEpoch = 1;
  private adjacentGroupEpoch = 1;

  scanGroupSize = 0;

  constructor(size: SupportedSize, options: PositionOptions = {}) {
    if (!SUPPORTED_SIZES.has(size)) {
      throw new Error(`Unsupported board size: ${size}`);
    }
    this.size = size;
    this.area = size * size;
    this.meta = getBoardMeta(size);
    this.board = new Uint8Array(this.area);

    const historyCapacity = Math.max(1, options.historyCapacity ?? this.area);
    const captureCapacity = Math.max(1, options.captureCapacity ?? this.area);
    this.historyMoves = new Int16Array(historyCapacity);
    this.historyPlayers = new Uint8Array(historyCapacity);
    this.historyKo = new Int16Array(historyCapacity);
    this.historyWinner = new Uint8Array(historyCapacity);
    this.historyCaptureStart = new Int32Array(historyCapacity);
    this.historyCaptureCount = new Int16Array(historyCapacity);
    this.historyZobristHi = new Int32Array(historyCapacity);
    this.historyZobristLo = new Int32Array(historyCapacity);
    this.capturePositions = new Int16Array(captureCapacity);

    this.groupVisitMarks = new Uint32Array(this.area);
    this.libertyMarks = new Uint32Array(this.area);
    this.adjacentGroupMarks = new Uint32Array(this.area);
    this.groupStack = new Int16Array(this.area);
    this.groupBuffer = new Int16Array(this.area);
  }

  static fromAscii(rows: string[], toMove: Player = BLACK, options: PositionOptions = {}): GogoPosition {
    const size = rows.length;
    if (!SUPPORTED_SIZES.has(size)) {
      throw new Error(`Unsupported board size: ${size}`);
    }
    const position = new GogoPosition(size as SupportedSize, options);
    position.toMove = toMove;

    for (let y = 0; y < size; y += 1) {
      const row = rows[y];
      if (row.length !== size) {
        throw new Error(`Row ${y} has invalid width ${row.length}, expected ${size}`);
      }
      for (let x = 0; x < size; x += 1) {
        const symbol = row[x];
        const index = y * size + x;
        if (symbol === '.' || symbol === '+') {
          continue;
        }
        if (symbol === 'X' || symbol === 'x' || symbol === 'B' || symbol === 'b') {
          position.board[index] = BLACK;
          position.stoneCount += 1;
          continue;
        }
        if (symbol === 'O' || symbol === 'o' || symbol === 'W' || symbol === 'w') {
          position.board[index] = WHITE;
          position.stoneCount += 1;
          continue;
        }
        throw new Error(`Unsupported board symbol: ${symbol}`);
      }
    }

    position.winner = position.detectExistingWinner();
    position.recomputeZobristHash();
    return position;
  }

  index(x: number, y: number): number {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) {
      return -1;
    }
    return y * this.size + x;
  }

  at(x: number, y: number): Cell {
    const index = this.index(x, y);
    return index === -1 ? EMPTY : (this.board[index] as Cell);
  }

  playXY(x: number, y: number): boolean {
    const index = this.index(x, y);
    return index !== -1 && this.play(index);
  }

  isLegal(index: number): boolean {
    const legal = this.play(index);
    if (legal) {
      this.undo();
    }
    return legal;
  }

  hasAnyLegalMove(): boolean {
    if (this.winner !== EMPTY) {
      return false;
    }
    for (let index = 0; index < this.area; index += 1) {
      if (this.board[index] === EMPTY && this.isLegal(index)) {
        return true;
      }
    }
    return false;
  }

  generateAllLegalMoves(buffer: Int16Array): number {
    if (this.winner !== EMPTY) {
      return 0;
    }
    let count = 0;
    for (let index = 0; index < this.area; index += 1) {
      if (this.board[index] === EMPTY && this.isLegal(index)) {
        buffer[count] = index;
        count += 1;
      }
    }
    return count;
  }

  play(index: number): boolean {
    if (
      this.winner !== EMPTY ||
      index < 0 ||
      index >= this.area ||
      this.board[index] !== EMPTY ||
      index === this.koPoint
    ) {
      return false;
    }

    this.ensureHistoryCapacity(this.ply + 1);
    const player = this.toMove;
    const opponent = otherPlayer(player);
    const captureStart = this.captureTop;
    let capturedCount = 0;

    this.board[index] = player;
    this.stoneCount += 1;

    const neighbors = this.meta.neighbors4;
    const neighborBase = index * 4;
    this.adjacentGroupEpoch += 1;

    for (let offset = 0; offset < 4; offset += 1) {
      const neighbor = neighbors[neighborBase + offset];
      if (neighbor === -1 || this.board[neighbor] !== opponent || this.adjacentGroupMarks[neighbor] === this.adjacentGroupEpoch) {
        continue;
      }
      const liberties = this.scanGroup(neighbor, opponent);
      for (let groupIndex = 0; groupIndex < this.scanGroupSize; groupIndex += 1) {
        this.adjacentGroupMarks[this.groupBuffer[groupIndex]] = this.adjacentGroupEpoch;
      }
      if (liberties !== 0) {
        continue;
      }
      this.ensureCaptureCapacity(this.captureTop + this.scanGroupSize);
      for (let groupIndex = 0; groupIndex < this.scanGroupSize; groupIndex += 1) {
        const point = this.groupBuffer[groupIndex];
        this.capturePositions[this.captureTop] = point;
        this.captureTop += 1;
        this.board[point] = EMPTY;
      }
      capturedCount += this.scanGroupSize;
      this.stoneCount -= this.scanGroupSize;
    }

    const madeFive = this.checkFiveFrom(index, player);
    const ownLiberties = this.scanGroup(index, player);
    const ownGroupSize = this.scanGroupSize;
    if (ownLiberties === 0 && !madeFive) {
      this.rollbackIllegalMove(index, opponent, captureStart, capturedCount);
      return false;
    }

    let nextKo = -1;
    if (!madeFive && capturedCount === 1 && ownGroupSize === 1 && ownLiberties === 1) {
      nextKo = this.capturePositions[captureStart];
    }

    this.historyMoves[this.ply] = index;
    this.historyPlayers[this.ply] = player;
    this.historyKo[this.ply] = this.koPoint;
    this.historyWinner[this.ply] = this.winner;
    this.historyCaptureStart[this.ply] = captureStart;
    this.historyCaptureCount[this.ply] = capturedCount;
    this.historyZobristHi[this.ply] = this.zobristHi;
    this.historyZobristLo[this.ply] = this.zobristLo;
    this.ply += 1;

    // Update Zobrist hash incrementally
    const meta = this.meta;
    let newHashHi = this.zobristHi;
    let newHashLo = this.zobristLo;
    if (player === WHITE) {
      newHashHi ^= meta.zobristWhiteToMoveHi;
      newHashLo ^= meta.zobristWhiteToMoveLo;
    }
    if (this.koPoint !== -1) {
      newHashHi ^= meta.zobristKoHi[this.koPoint];
      newHashLo ^= meta.zobristKoLo[this.koPoint];
    }
    newHashHi ^= meta.zobristStoneHi[index * 2 + player - 1];
    newHashLo ^= meta.zobristStoneLo[index * 2 + player - 1];
    for (let i = captureStart; i < this.captureTop; i += 1) {
      const point = this.capturePositions[i];
      newHashHi ^= meta.zobristStoneHi[point * 2 + opponent - 1];
      newHashLo ^= meta.zobristStoneLo[point * 2 + opponent - 1];
    }
    if (nextKo !== -1) {
      newHashHi ^= meta.zobristKoHi[nextKo];
      newHashLo ^= meta.zobristKoLo[nextKo];
    }
    if (opponent === WHITE) {
      newHashHi ^= meta.zobristWhiteToMoveHi;
      newHashLo ^= meta.zobristWhiteToMoveLo;
    }
    this.zobristHi = newHashHi;
    this.zobristLo = newHashLo;

    this.koPoint = nextKo;
    this.toMove = opponent;
    this.winner = madeFive ? player : EMPTY;
    this.lastMove = index;
    this.lastCapturedCount = capturedCount;
    return true;
  }

  undo(): boolean {
    if (this.ply === 0) {
      return false;
    }
    this.ply -= 1;
    const index = this.historyMoves[this.ply];
    const player = this.historyPlayers[this.ply] as Player;
    const opponent = otherPlayer(player);
    const captureStart = this.historyCaptureStart[this.ply];
    const captureCount = this.historyCaptureCount[this.ply];

    this.board[index] = EMPTY;
    this.stoneCount -= 1;
    for (let i = 0; i < captureCount; i += 1) {
      const point = this.capturePositions[captureStart + i];
      this.board[point] = opponent;
    }
    this.stoneCount += captureCount;
    this.captureTop = captureStart;
    this.toMove = player;
    this.koPoint = this.historyKo[this.ply];
    this.winner = this.historyWinner[this.ply] as Cell;
    this.lastMove = this.ply === 0 ? -1 : this.historyMoves[this.ply - 1];
    this.lastCapturedCount = this.ply === 0 ? 0 : this.historyCaptureCount[this.ply - 1];
    this.zobristHi = this.historyZobristHi[this.ply];
    this.zobristLo = this.historyZobristLo[this.ply];
    return true;
  }

  scanGroup(start: number, color: Player): number {
    this.groupVisitEpoch += 1;
    this.libertyEpoch += 1;
    const visitEpoch = this.groupVisitEpoch;
    const libertyEpoch = this.libertyEpoch;
    const stack = this.groupStack;
    const buffer = this.groupBuffer;
    const board = this.board;
    const neighbors = this.meta.neighbors4;

    let stackSize = 0;
    let bufferSize = 0;
    let liberties = 0;

    stack[stackSize] = start;
    stackSize += 1;
    this.groupVisitMarks[start] = visitEpoch;

    while (stackSize !== 0) {
      stackSize -= 1;
      const point = stack[stackSize];
      buffer[bufferSize] = point;
      bufferSize += 1;

      const neighborBase = point * 4;
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = neighbors[neighborBase + offset];
        if (neighbor === -1) {
          continue;
        }
        const cell = board[neighbor];
        if (cell === EMPTY) {
          if (this.libertyMarks[neighbor] !== libertyEpoch) {
            this.libertyMarks[neighbor] = libertyEpoch;
            liberties += 1;
          }
        } else if (cell === color && this.groupVisitMarks[neighbor] !== visitEpoch) {
          this.groupVisitMarks[neighbor] = visitEpoch;
          stack[stackSize] = neighbor;
          stackSize += 1;
        }
      }
    }

    this.scanGroupSize = bufferSize;
    return liberties;
  }

  detectExistingWinner(): Cell {
    const windows = this.meta.windows;
    for (let windowIndex = 0; windowIndex < this.meta.windowCount; windowIndex += 1) {
      const base = windowIndex * 5;
      const first = this.board[windows[base]];
      if (first === EMPTY) {
        continue;
      }
      let allEqual = true;
      for (let step = 1; step < 5; step += 1) {
        if (this.board[windows[base + step]] !== first) {
          allEqual = false;
          break;
        }
      }
      if (allEqual) {
        return first as Cell;
      }
    }
    return EMPTY;
  }

  private ensureHistoryCapacity(minimumLength: number): void {
    if (minimumLength <= this.historyMoves.length) {
      return;
    }
    this.historyMoves = growInt16Array(this.historyMoves, minimumLength);
    this.historyPlayers = growUint8Array(this.historyPlayers, minimumLength);
    this.historyKo = growInt16Array(this.historyKo, minimumLength);
    this.historyWinner = growUint8Array(this.historyWinner, minimumLength);
    this.historyCaptureStart = growInt32Array(this.historyCaptureStart, minimumLength);
    this.historyCaptureCount = growInt16Array(this.historyCaptureCount, minimumLength);
    this.historyZobristHi = growInt32Array(this.historyZobristHi, minimumLength);
    this.historyZobristLo = growInt32Array(this.historyZobristLo, minimumLength);
  }

  private ensureCaptureCapacity(minimumLength: number): void {
    if (minimumLength <= this.capturePositions.length) {
      return;
    }
    this.capturePositions = growInt16Array(this.capturePositions, minimumLength);
  }

  private rollbackIllegalMove(index: number, opponent: Player, captureStart: number, capturedCount: number): void {
    this.board[index] = EMPTY;
    this.stoneCount -= 1;
    for (let i = captureStart; i < this.captureTop; i += 1) {
      const point = this.capturePositions[i];
      this.board[point] = opponent;
    }
    this.stoneCount += capturedCount;
    this.captureTop = captureStart;
  }

  recomputeZobristHash(): void {
    const meta = this.meta;
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < this.area; i += 1) {
      const stone = this.board[i];
      if (stone !== EMPTY) {
        hi ^= meta.zobristStoneHi[i * 2 + stone - 1];
        lo ^= meta.zobristStoneLo[i * 2 + stone - 1];
      }
    }
    if (this.toMove === WHITE) {
      hi ^= meta.zobristWhiteToMoveHi;
      lo ^= meta.zobristWhiteToMoveLo;
    }
    if (this.koPoint !== -1) {
      hi ^= meta.zobristKoHi[this.koPoint];
      lo ^= meta.zobristKoLo[this.koPoint];
    }
    this.zobristHi = hi;
    this.zobristLo = lo;
  }

  encodeGame(): string {
    const moves: string[] = [];
    for (let i = 0; i < this.ply; i += 1) {
      moves.push(encodeMove(this.historyMoves[i], this.meta));
    }
    return `B${this.size}${moves.length > 0 ? ' ' + moves.join(' ') : ''}`;
  }

  private checkFiveFrom(index: number, color: Player): boolean {
    const x = this.meta.xs[index];
    const y = this.meta.ys[index];
    const size = this.size;

    const directions = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as const;

    for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
      const dx = directions[directionIndex][0];
      const dy = directions[directionIndex][1];
      let count = 1;

      let nx = x + dx;
      let ny = y + dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && this.board[ny * size + nx] === color) {
        count += 1;
        nx += dx;
        ny += dy;
      }

      nx = x - dx;
      ny = y - dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && this.board[ny * size + nx] === color) {
        count += 1;
        nx -= dx;
        ny -= dy;
      }

      if (count >= 5) {
        return true;
      }
    }

    return false;
  }
}

export function playerName(player: Player): 'black' | 'white' {
  return player === BLACK ? 'black' : 'white';
}

export function encodeMove(index: number, meta: BoardMeta): string {
  const x = meta.xs[index];
  const y = meta.ys[index];
  return String.fromCharCode('a'.charCodeAt(0) + x) + String(y + 1);
}

export function decodeMove(move: string, size: SupportedSize): number {
  if (move.length < 2) {
    return -1;
  }
  const colChar = move[0].toLowerCase();
  if (colChar < 'a' || colChar > 'z') {
    return -1;
  }
  const rowStr = move.slice(1);
  if (!/^\d+$/.test(rowStr)) {
    return -1;
  }
  const x = colChar.charCodeAt(0) - 'a'.charCodeAt(0);
  const y = parseInt(rowStr, 10) - 1;
  if (x >= size || y < 0 || y >= size) {
    return -1;
  }
  return y * size + x;
}

export function decodeGame(encoded: string): GogoPosition {
  const parts = encoded.trim().split(/\s+/);
  const sizeToken = parts[0];
  if (!/^B(9|11|13)$/.test(sizeToken)) {
    throw new Error(`Invalid board size token: ${sizeToken}`);
  }
  const size = parseInt(sizeToken.slice(1), 10) as SupportedSize;
  const position = new GogoPosition(size);
  for (let i = 1; i < parts.length; i += 1) {
    const moveStr = parts[i];
    const index = decodeMove(moveStr, size);
    if (index === -1) {
      throw new Error(`Invalid move: ${moveStr}`);
    }
    if (!position.play(index)) {
      throw new Error(`Illegal move: ${moveStr}`);
    }
  }
  return position;
}
