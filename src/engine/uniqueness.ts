import { EMPTY, BLACK, WHITE, GogoPosition } from './gogomoku';
import type { Player } from './gogomoku';

// A stone: (x, y, color)
export type Stone = readonly [number, number, Player];

// The 8 symmetries of the dihedral group D4 acting on 2-D coordinates.
// After each transform the result is translated so that minX = 0 and minY = 0.
export type TransformFn = (x: number, y: number) => readonly [number, number];

export interface CanonicalKeyOptions {
  boardSize?: number;
  includeTranslationSymmetry?: boolean;
  includeColorSymmetry?: boolean;
}

export const DIHEDRAL_TRANSFORMS: readonly TransformFn[] = [
  (x, y) => [x, y],     // identity
  (x, y) => [-y, x],    // rotate 90° CCW
  (x, y) => [-x, -y],   // rotate 180°
  (x, y) => [y, -x],    // rotate 270° CCW
  (x, y) => [-x, y],    // reflect about y-axis
  (x, y) => [x, -y],    // reflect about x-axis
  (x, y) => [y, x],     // reflect about main diagonal
  (x, y) => [-y, -x],   // reflect about anti-diagonal
];

function sortPackedKeys(packed: Uint16Array, count: number): void {
  if (count < 2) {
    return;
  }

  if (count >= 16) {
    packed.subarray(0, count).sort();
    return;
  }

  for (let i = 1; i < count; i += 1) {
    const value = packed[i];
    let j = i - 1;
    while (j >= 0 && packed[j] > value) {
      packed[j + 1] = packed[j];
      j -= 1;
    }
    packed[j + 1] = value;
  }
}

function encodePackedKeys(packed: Uint16Array, count: number): string {
  let key = '';
  for (let i = 0; i < count; i += 1) {
    key += String.fromCharCode(packed[i]);
  }
  return key;
}

export function transformPoint(
  transformIndex: number,
  x: number,
  y: number,
  boardSize: number | undefined,
): readonly [number, number] {
  if (boardSize === undefined) {
    return DIHEDRAL_TRANSFORMS[transformIndex](x, y);
  }
  switch (transformIndex) {
    case 0: return [x, y];
    case 1: return [boardSize - 1 - y, x];
    case 2: return [boardSize - 1 - x, boardSize - 1 - y];
    case 3: return [y, boardSize - 1 - x];
    case 4: return [boardSize - 1 - x, y];
    case 5: return [x, boardSize - 1 - y];
    case 6: return [y, x];
    default: return [boardSize - 1 - y, boardSize - 1 - x];
  }
}

/**
 * Compute the canonical key for a set of stones that is invariant under
 * all rotations, reflections, translations, and color swap.
 */
export function computeCanonicalPackedKey(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  colors: ArrayLike<number>,
  count: number,
  options: CanonicalKeyOptions = {},
  packedScratch?: Uint16Array,
): string {
  if (count === 0) {
    return '';
  }

  const packed = packedScratch ?? new Uint16Array(count);
  const boardSize = options.boardSize;
  const translate = options.includeTranslationSymmetry !== false;
  const colorVariants = options.includeColorSymmetry === false ? 1 : 2;
  let minKey = '';
  for (let transformIndex = 0; transformIndex < DIHEDRAL_TRANSFORMS.length; transformIndex += 1) {
    for (let variant = 0; variant < colorVariants; variant += 1) {
      let minX = 0;
      let minY = 0;
      if (translate) {
        for (let i = 0; i < count; i += 1) {
          const [x, y] = transformPoint(transformIndex, xs[i], ys[i], boardSize);
          if (i === 0 || x < minX) {
            minX = x;
          }
          if (i === 0 || y < minY) {
            minY = y;
          }
        }
      }
      for (let i = 0; i < count; i += 1) {
        const [x, y] = transformPoint(transformIndex, xs[i], ys[i], boardSize);
        const color = variant === 0
          ? colors[i]
          : (colors[i] === BLACK ? WHITE : BLACK);
        packed[i] = ((((x - minX) << 4) | (y - minY)) << 2) | color;
      }
      sortPackedKeys(packed, count);
      const key = encodePackedKeys(packed, count);
      if (minKey === '' || key < minKey) {
        minKey = key;
      }
    }
  }

  return minKey;
}

export function computeCanonicalKey(
  stones: readonly Stone[],
  options: CanonicalKeyOptions = {},
): string {
  if (stones.length === 0) {
    return '';
  }

  const xs = new Int16Array(stones.length);
  const ys = new Int16Array(stones.length);
  const colors = new Uint8Array(stones.length);
  for (let i = 0; i < stones.length; i += 1) {
    xs[i] = stones[i][0];
    ys[i] = stones[i][1];
    colors[i] = stones[i][2];
  }
  return computeCanonicalPackedKey(xs, ys, colors, stones.length, options);
}

/**
 * Remove stones that have no orthogonally adjacent stone (of either color).
 */
export function removeIsolatedStones(stones: readonly Stone[]): Stone[] {
  if (stones.length === 0) {
    return [];
  }

  // Encode occupied positions for fast lookup.  Coordinates fit in a board so
  // we pack them as x * 10000 + y (board size ≤ 13, so max coordinate < 13).
  const occupied = new Set<number>();
  for (const [x, y] of stones) {
    occupied.add(x * 10000 + y);
  }

  return stones.filter(
    ([x, y]) =>
      occupied.has((x + 1) * 10000 + y) ||
      occupied.has((x - 1) * 10000 + y) ||
      occupied.has(x * 10000 + (y + 1)) ||
      occupied.has(x * 10000 + (y - 1)) ||
      occupied.has((x + 1) * 10000 + (y + 1)) ||
      occupied.has((x + 1) * 10000 + (y - 1)) ||
      occupied.has((x - 1) * 10000 + (y + 1)) ||
      occupied.has((x - 1) * 10000 + (y - 1)),
  );
}

/**
 * Extract the stones present on the board after replaying the first
 * min(maxMoves, position.ply) moves from the given position's history.
 */
function getStonesAtFirstNMoves(position: GogoPosition, maxMoves: number): Stone[] {
  const n = Math.min(maxMoves, position.ply);

  if (n === 0) {
    return [];
  }

  const temp = new GogoPosition(position.size);
  for (let i = 0; i < n; i += 1) {
    temp.play(position.getMoveAt(i));
  }

  const stones: Stone[] = [];
  for (let i = 0; i < temp.area; i += 1) {
    const cell = temp.board[i];
    if (cell !== EMPTY) {
      stones.push([temp.meta.xs[i], temp.meta.ys[i], cell as Player]);
    }
  }

  return stones;
}

/**
 * Checks whether a board position is unique against a pre-built list of boards.
 *
 * Two positions are considered equivalent when — after truncating to the first
 * `maxMoves` moves and removing all isolated stones — one can be transformed
 * into the other by any combination of rotation, reflection, translation, and
 * color swap.
 *
 * Uniqueness checks after construction are O(1) in the number of boards.
 */
export class BoardUniquenessChecker {
  private readonly seen: Set<string>;
  private readonly maxMoves: number;

  constructor(boards: readonly GogoPosition[], maxMoves: number) {
    this.maxMoves = maxMoves;
    this.seen = new Set<string>();
    for (const board of boards) {
      this.seen.add(this.computeKey(board));
    }
  }

  private computeKey(position: GogoPosition): string {
    const stones = getStonesAtFirstNMoves(position, this.maxMoves);
    const filtered = removeIsolatedStones(stones);
    return computeCanonicalKey(filtered);
  }

  /** Returns true when the position is not equivalent to any board in the list. */
  isUnique(position: GogoPosition): boolean {
    return !this.seen.has(this.computeKey(position));
  }

  /** Number of distinct canonical patterns stored. */
  get size(): number {
    return this.seen.size;
  }
}
