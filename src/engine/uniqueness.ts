import { EMPTY, BLACK, WHITE, GogoPosition } from './gogomoku';
import type { Player } from './gogomoku';

// A stone: (x, y, color)
type Stone = readonly [number, number, Player];

// The 8 symmetries of the dihedral group D4 acting on 2-D coordinates.
// After each transform the result is translated so that minX = 0 and minY = 0.
type TransformFn = (x: number, y: number) => readonly [number, number];

const DIHEDRAL_TRANSFORMS: readonly TransformFn[] = [
  (x, y) => [x, y],     // identity
  (x, y) => [-y, x],    // rotate 90° CCW
  (x, y) => [-x, -y],   // rotate 180°
  (x, y) => [y, -x],    // rotate 270° CCW
  (x, y) => [-x, y],    // reflect about y-axis
  (x, y) => [x, -y],    // reflect about x-axis
  (x, y) => [y, x],     // reflect about main diagonal
  (x, y) => [-y, -x],   // reflect about anti-diagonal
];

function applyTransformAndNormalize(
  stones: readonly Stone[],
  transform: TransformFn,
  swapColors: boolean,
): Stone[] {
  const result: Stone[] = new Array(stones.length);
  let minX = 0;
  let minY = 0;

  for (let i = 0; i < stones.length; i += 1) {
    const [tx, ty] = transform(stones[i][0], stones[i][1]);
    const tc: Player = swapColors ? (stones[i][2] === BLACK ? WHITE : BLACK) : stones[i][2];
    result[i] = [tx, ty, tc];
    if (i === 0 || tx < minX) {
      minX = tx;
    }
    if (i === 0 || ty < minY) {
      minY = ty;
    }
  }

  for (let i = 0; i < result.length; i += 1) {
    result[i] = [result[i][0] - minX, result[i][1] - minY, result[i][2]];
  }

  result.sort((a, b) => {
    if (a[0] !== b[0]) {
      return a[0] - b[0];
    }
    return a[1] - b[1];
  });

  return result;
}

function encodeStonesKey(stones: readonly Stone[]): string {
  let key = '';
  for (let i = 0; i < stones.length; i += 1) {
    if (i > 0) {
      key += ';';
    }
    key += `${stones[i][0]},${stones[i][1]},${stones[i][2]}`;
  }
  return key;
}

/**
 * Compute the canonical key for a set of stones that is invariant under
 * all rotations, reflections, translations, and color swap.
 */
export function computeCanonicalKey(stones: readonly Stone[]): string {
  if (stones.length === 0) {
    return '';
  }

  let minKey = '';
  for (const transform of DIHEDRAL_TRANSFORMS) {
    for (const swapColors of [false, true]) {
      const normalized = applyTransformAndNormalize(stones, transform, swapColors);
      const key = encodeStonesKey(normalized);
      if (minKey === '' || key < minKey) {
        minKey = key;
      }
    }
  }

  return minKey;
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
      occupied.has(x * 10000 + (y - 1)),
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
