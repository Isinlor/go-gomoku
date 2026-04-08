import { test, expect } from 'vitest';

import { BLACK, WHITE, GogoPosition } from '../../src/engine/gogomoku';
import {
  removeIsolatedStones,
  computeCanonicalKey,
  BoardUniquenessChecker,
} from '../../src/engine/uniqueness';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a GogoPosition and play a sequence of (x,y) pairs. */
function makePos(size: 9 | 11 | 13, ...moves: [number, number][]): GogoPosition {
  const pos = new GogoPosition(size);
  for (const [x, y] of moves) {
    pos.playXY(x, y);
  }
  return pos;
}

// ─── getMoveAt ───────────────────────────────────────────────────────────────

test('getMoveAt returns -1 for out-of-range ply values', () => {
  const pos = makePos(9, [3, 3], [4, 4]);
  expect(pos.getMoveAt(-1)).toBe(-1);
  expect(pos.getMoveAt(2)).toBe(-1);
  expect(pos.getMoveAt(100)).toBe(-1);
});

test('getMoveAt returns the correct board index for valid ply values', () => {
  const pos = makePos(9, [3, 3], [4, 4]);
  // ply 0 → BLACK at (3,3) → index 3*9+3 = 30... wait, index = y*size+x = 3*9+3 = 30
  expect(pos.getMoveAt(0)).toBe(pos.index(3, 3));
  expect(pos.getMoveAt(1)).toBe(pos.index(4, 4));
});

// ─── removeIsolatedStones ────────────────────────────────────────────────────

test('removeIsolatedStones returns empty for empty input', () => {
  expect(removeIsolatedStones([])).toEqual([]);
});

test('removeIsolatedStones removes a stone with no neighbors', () => {
  // Single stone: isolated
  const result = removeIsolatedStones([[3, 3, BLACK]]);
  expect(result).toHaveLength(0);
});

test('removeIsolatedStones keeps stones that have at least one neighbor', () => {
  // Two adjacent stones
  const stones = [[3, 3, BLACK], [4, 3, WHITE]] as const;
  const result = removeIsolatedStones(stones);
  expect(result).toHaveLength(2);
});

test('removeIsolatedStones filters out only the isolated stones', () => {
  // (3,3) BLACK adjacent to (4,3) WHITE → kept
  // (0,0) BLACK alone → removed
  const stones = [
    [3, 3, BLACK],
    [4, 3, WHITE],
    [0, 0, BLACK],
  ] as const;
  const result = removeIsolatedStones(stones);
  expect(result).toHaveLength(2);
  expect(result.some(([x, y]) => x === 0 && y === 0)).toBe(false);
});

test('removeIsolatedStones handles vertical, horizontal, and diagonal adjacency correctly', () => {
  // Only orthogonal neighbors count; diagonal does not make a stone non-isolated
  const stones = [
    [0, 0, BLACK], // only diagonal neighbor at (1,1)
    [1, 1, WHITE], // only diagonal neighbor at (0,0)
  ] as const;
  const result = removeIsolatedStones(stones);
  expect(result).toHaveLength(0);

  // Vertical neighbor
  const vertStones = [
    [2, 2, BLACK],
    [2, 3, WHITE],
  ] as const;
  const vertResult = removeIsolatedStones(vertStones);
  expect(vertResult).toHaveLength(2);
});

// ─── computeCanonicalKey ─────────────────────────────────────────────────────

test('computeCanonicalKey returns empty string for empty input', () => {
  expect(computeCanonicalKey([])).toBe('');
});

test('computeCanonicalKey returns a stable key for a single stone', () => {
  // A lone stone always maps to (0,0,color) or its color-swap (0,0,otherColor)
  const keyBlack = computeCanonicalKey([[5, 3, BLACK]]);
  const keyWhite = computeCanonicalKey([[5, 3, WHITE]]);
  // After color swap, a lone BLACK becomes a lone WHITE → same canonical form
  expect(keyBlack).toBe(keyWhite);
  // The normalized position of a lone stone is always (0,0,...)
  expect(keyBlack.startsWith('0,0,')).toBe(true);
});

test('computeCanonicalKey is invariant under translation', () => {
  // Same relative pattern at two different board locations
  const a = computeCanonicalKey([[3, 3, BLACK], [4, 3, WHITE]]);
  const b = computeCanonicalKey([[1, 1, BLACK], [2, 1, WHITE]]);
  expect(a).toBe(b);
});

test('computeCanonicalKey is invariant under 90-degree rotation', () => {
  // Original: BLACK at (0,0), WHITE at (1,0) → relative offset (1,0)
  // Rotated 90° CCW: BLACK at (0,0), WHITE at (0,1) → relative offset (0,1)
  const a = computeCanonicalKey([[0, 0, BLACK], [1, 0, WHITE]]);
  const b = computeCanonicalKey([[0, 0, BLACK], [0, 1, WHITE]]);
  expect(a).toBe(b);
});

test('computeCanonicalKey is invariant under 180-degree rotation', () => {
  const a = computeCanonicalKey([[0, 0, BLACK], [1, 0, WHITE]]);
  // After 180°: (0,0)→(0,0), (1,0)→(-1,0); normalize: BLACK(1,0), WHITE(0,0)
  const b = computeCanonicalKey([[1, 0, BLACK], [0, 0, WHITE]]);
  expect(a).toBe(b);
});

test('computeCanonicalKey is invariant under reflection', () => {
  // Reflect about main diagonal: (x,y) → (y,x)
  const a = computeCanonicalKey([[0, 0, BLACK], [2, 1, WHITE]]);
  const b = computeCanonicalKey([[0, 0, BLACK], [1, 2, WHITE]]);
  expect(a).toBe(b);
});

test('computeCanonicalKey is invariant under color swap', () => {
  const a = computeCanonicalKey([[0, 0, BLACK], [1, 0, WHITE]]);
  const b = computeCanonicalKey([[0, 0, WHITE], [1, 0, BLACK]]);
  expect(a).toBe(b);
});

test('computeCanonicalKey produces different keys for genuinely different patterns', () => {
  // Two stones adjacent vs. two stones 2 apart
  const adjacent = computeCanonicalKey([[0, 0, BLACK], [1, 0, WHITE]]);
  const farApart = computeCanonicalKey([[0, 0, BLACK], [2, 0, WHITE]]);
  expect(adjacent).not.toBe(farApart);

  // Three stones in a row vs. L-shape
  const row = computeCanonicalKey([[0, 0, BLACK], [1, 0, BLACK], [2, 0, BLACK]]);
  const lShape = computeCanonicalKey([[0, 0, BLACK], [1, 0, BLACK], [1, 1, BLACK]]);
  expect(row).not.toBe(lShape);
});

// ─── BoardUniquenessChecker ──────────────────────────────────────────────────

test('constructor with empty board list produces size 0', () => {
  const checker = new BoardUniquenessChecker([], 5);
  expect(checker.size).toBe(0);
  expect(checker.isUnique(new GogoPosition(9))).toBe(true);
});

test('isUnique returns false for the same board that was added', () => {
  const pos = makePos(9, [4, 4], [5, 4]);
  const checker = new BoardUniquenessChecker([pos], 2);
  const same = makePos(9, [4, 4], [5, 4]);
  expect(checker.isUnique(same)).toBe(false);
});

test('isUnique returns true for a genuinely different board', () => {
  const pos = makePos(9, [4, 4], [5, 4]);
  const checker = new BoardUniquenessChecker([pos], 2);
  // Different pattern: stones far apart
  const different = makePos(9, [4, 4], [4, 6]);
  expect(checker.isUnique(different)).toBe(true);
});

test('isUnique returns false for a rotated-equivalent board', () => {
  // Board A: BLACK (4,4), WHITE (5,4)  – relative offset (1,0)
  const posA = makePos(9, [4, 4], [5, 4]);
  const checker = new BoardUniquenessChecker([posA], 2);

  // Board B: BLACK (4,4), WHITE (4,5)  – relative offset (0,1) = 90° rotation
  const posB = makePos(9, [4, 4], [4, 5]);
  expect(checker.isUnique(posB)).toBe(false);
});

test('isUnique returns false for a translated-equivalent board', () => {
  const posA = makePos(9, [4, 4], [5, 4]);
  const checker = new BoardUniquenessChecker([posA], 2);

  const posB = makePos(9, [1, 1], [2, 1]);
  expect(checker.isUnique(posB)).toBe(false);
});

test('isUnique returns false for a color-swapped-equivalent board', () => {
  // posA: BLACK (4,4), WHITE (5,4)
  // For the color-swapped equivalent we need WHITE at an anchor and BLACK adjacent.
  // Build posC with an isolated BLACK first, then WHITE and BLACK adjacent:
  //   Move 1: BLACK (0,0) → isolated → removed after filtering
  //   Move 2: WHITE (4,4)
  //   Move 3: BLACK (5,4)
  // After removeIsolatedStones: WHITE(4,4), BLACK(5,4) → color-swap of posA pattern
  const posA = makePos(9, [4, 4], [5, 4]);
  const checker = new BoardUniquenessChecker([posA], 3);

  const posC = makePos(9, [0, 0], [4, 4], [5, 4]);
  expect(checker.isUnique(posC)).toBe(false);
});

test('isUnique returns false for a reflected-equivalent board', () => {
  // Board A: BLACK (4,4), WHITE (6,5) – two stones with offset (2,1)
  const posA = makePos(9, [4, 4], [6, 5]);
  const checker = new BoardUniquenessChecker([posA], 2);

  // Reflect about main diagonal: offset (2,1) → (1,2)
  const posB = makePos(9, [4, 4], [5, 6]);
  expect(checker.isUnique(posB)).toBe(false);
});

test('maxMoves limits comparison to only the first n moves', () => {
  // With maxMoves=2 the checker ignores any moves beyond the 2nd.
  const posA = makePos(9, [4, 4], [5, 4]);
  const checker2 = new BoardUniquenessChecker([posA], 2);

  // posB has the same first 2 moves but an extra 3rd move; should still match
  const posB = makePos(9, [4, 4], [5, 4], [6, 4]);
  expect(checker2.isUnique(posB)).toBe(false);

  // With maxMoves=1 only the first move (BLACK at (4,4)) is considered.
  // A lone stone is isolated → pattern becomes empty → key = ''.
  // Both posA and a single-stone board have key '', so they match.
  const checker1 = new BoardUniquenessChecker([posA], 1);
  const posOne = makePos(9, [3, 3]);
  expect(checker1.isUnique(posOne)).toBe(false);
});

test('all-isolated board (maxMoves=1 single stone) matches empty board', () => {
  const posA = makePos(9, [4, 4]);
  const checker = new BoardUniquenessChecker([posA], 1);
  // An empty board also produces key ''
  expect(checker.isUnique(new GogoPosition(9))).toBe(false);
});

test('size deduplicates equivalent boards', () => {
  const posA = makePos(9, [4, 4], [5, 4]);
  // posB is a rotation of posA → same canonical key
  const posB = makePos(9, [4, 4], [4, 5]);
  const checker = new BoardUniquenessChecker([posA, posB], 2);
  // Both map to the same key → set size is 1
  expect(checker.size).toBe(1);
});

test('size counts genuinely different boards separately', () => {
  const posA = makePos(9, [4, 4], [5, 4]);
  const posB = makePos(9, [4, 4], [4, 6]); // gap of 2, not adjacent → different
  const checker = new BoardUniquenessChecker([posA, posB], 2);
  expect(checker.size).toBe(2);
});

test('isolated stones are removed before comparison so two boards match', () => {
  // posA: BLACK (4,4), WHITE (5,4) → non-isolated pattern
  // posB: BLACK (0,0) isolated, BLACK (4,4), WHITE (5,4)
  //   → after removing isolated: same pattern as posA (first 3 moves, n=3)
  const posA = makePos(9, [4, 4], [5, 4]);
  const posB = makePos(9, [0, 0], [4, 4], [5, 4]);

  const checker = new BoardUniquenessChecker([posA], 3);
  expect(checker.isUnique(posB)).toBe(false);
});

test('positions with only isolated stones both collapse to empty key', () => {
  const posA = makePos(9, [0, 0]);  // single isolated stone
  const posB = makePos(9, [8, 8]);  // different isolated stone
  const checker = new BoardUniquenessChecker([posA], 1);
  // Both produce canonical key '' → posB is not unique
  expect(checker.isUnique(posB)).toBe(false);
});

test('works correctly on 11x11 and 13x13 boards', () => {
  const pos11 = makePos(11, [5, 5], [6, 5]);
  const checker11 = new BoardUniquenessChecker([pos11], 2);
  const pos11rot = makePos(11, [5, 5], [5, 6]);
  expect(checker11.isUnique(pos11rot)).toBe(false);

  const pos13 = makePos(13, [6, 6], [7, 6]);
  const checker13 = new BoardUniquenessChecker([pos13], 2);
  const pos13trans = makePos(13, [3, 3], [4, 3]);
  expect(checker13.isUnique(pos13trans)).toBe(false);
});

test('270-degree rotation invariance', () => {
  // offset (1,0) rotated 270° CCW = (0,-1) → normalized (0,0) and (1,1)? No.
  // D4 element: (x,y) → (y,-x); apply to (0,0)→(0,0), (1,0)→(0,-1);
  // normalize: add (0,1): (0,1) and (0,0) → sorted: BLACK(0,0)? depends on colors
  // Let's just test with a 3-stone L-shape under all rotations
  const base = computeCanonicalKey([[0, 0, BLACK], [1, 0, BLACK], [0, 1, BLACK]]);
  // Rotate 270°: (x,y)→(y,-x): (0,0)→(0,0),(1,0)→(0,-1),(0,1)→(1,0)
  //   normalize by minY=-1: (0,1),(0,0)... wait let me just check via position
  const lA = makePos(9, [2, 2], [2, 3], [3, 2]); // first move BLACK, but that's 3 blacks
  // Actually these alternate: B(2,2), W(2,3), B(3,2)
  // Let me use computeCanonicalKey directly with a 3-stone pattern
  const rot270 = computeCanonicalKey([[0, 0, BLACK], [0, -1, BLACK], [1, 0, BLACK]]);
  // After normalization minY=-1: (0,1),(0,0),(1,1)
  expect(base).toBe(rot270);
});

test('anti-diagonal reflection invariance', () => {
  // (x,y) → (-y,-x): (0,0)→(0,0), (2,1)→(-1,-2); normalize: (1,2),(0,0)
  const a = computeCanonicalKey([[0, 0, BLACK], [2, 1, WHITE]]);
  const b = computeCanonicalKey([[1, 2, BLACK], [0, 0, WHITE]]);
  // color swap of b: (1,2,BLACK)→(1,2,WHITE),(0,0,WHITE)→(0,0,BLACK)
  // canonicalize b directly (without color swap noted above, let's trust the function)
  expect(a).toBe(b);
});
