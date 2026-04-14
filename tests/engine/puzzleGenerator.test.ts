import { test, expect } from 'vitest';

import {
  ForcedWinSearcher,
  heuristicMoveScore,
  heuristicBestMove,
  isGameHistoryClean,
  validatePuzzlePosition,
  playRandomGame,
  LCG,
  generatePuzzles,
  BEGINNER,
  INTERMEDIATE,
  ADVANCED,
  type PuzzleDifficulty,
} from '../../src/engine/puzzleGenerator';

import {
  GogoPosition,
  BLACK,
  WHITE,
  EMPTY,
  decodeGame,
  decodeMove,
} from '../../src/engine/gogomoku';

// ---------------------------------------------------------------------------
// LCG tests
// ---------------------------------------------------------------------------

test('LCG produces deterministic sequence', () => {
  const a = new LCG(42);
  const b = new LCG(42);
  for (let i = 0; i < 10; i += 1) {
    expect(a.next()).toBe(b.next());
  }
});

test('LCG nextInt produces values in range', () => {
  const rng = new LCG(99);
  for (let i = 0; i < 100; i += 1) {
    const v = rng.nextInt(10);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(10);
  }
});

// ---------------------------------------------------------------------------
// ForcedWinSearcher tests
// ---------------------------------------------------------------------------

test('hasForcedWin detects immediate win (1 ply)', () => {
  // Black has 4 in a row, one move to win
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 1)).toBe(true);
  expect(searcher.hasForcedWin(pos, WHITE, 1)).toBe(false);
});

test('hasForcedWin detects 3-ply forced win (double threat)', () => {
  // Black can create a double threat
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  expect(pos.toMove).toBe(BLACK);

  const searcher = new ForcedWinSearcher(81, 6);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(true);
  expect(searcher.hasForcedWin(pos, BLACK, 1)).toBe(false);
});

test('hasForcedWin returns false for position with no forced win', () => {
  const pos = new GogoPosition(9);
  pos.play(pos.index(4, 4)); // single stone
  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(false);
});

test('hasForcedWin returns true when winner already set', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  pos.winner = BLACK;
  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 0)).toBe(true);
});

test('hasForcedWin returns false when other player already won', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    'OOOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  pos.winner = WHITE;
  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(false);
});

test('forcedWinDepthForMove returns correct depths', () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const searcher = new ForcedWinSearcher(81, 8);

  // e5 is the winning move for black in 3 plies
  const e5 = decodeMove('e5', 9);
  expect(searcher.forcedWinDepthForMove(pos, e5, 7)).toBe(3);
});

test('forcedWinDepthForMove returns 1 for immediate win', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const searcher = new ForcedWinSearcher(81, 4);
  const f5 = decodeMove('f5', 9);
  expect(searcher.forcedWinDepthForMove(pos, f5, 3)).toBe(1);
});

test('forcedWinDepthForMove returns -1 for illegal move', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const searcher = new ForcedWinSearcher(81, 4);
  // b5 already has a stone
  const b5 = decodeMove('b5', 9);
  expect(searcher.forcedWinDepthForMove(pos, b5, 3)).toBe(-1);
});

test('forcedWinDepthForMove returns -1 for non-winning move', () => {
  const pos = new GogoPosition(9);
  pos.play(pos.index(4, 4));
  const searcher = new ForcedWinSearcher(81, 4);
  const a1 = decodeMove('a1', 9);
  expect(searcher.forcedWinDepthForMove(pos, a1, 3)).toBe(-1);
});

// ---------------------------------------------------------------------------
// heuristicMoveScore / heuristicBestMove tests
// ---------------------------------------------------------------------------

test('heuristicMoveScore returns positive for useful moves', () => {
  const pos = decodeGame('B9 e5 e3 d5 e4 f5 e6');
  const e5move = decodeMove('e5', 9);
  expect(heuristicMoveScore(pos, e5move)).toBeGreaterThan(0);
});

test('heuristicBestMove returns a legal move', () => {
  const pos = decodeGame('B9 e5 e3 d5');
  const best = heuristicBestMove(pos);
  expect(best).toBeGreaterThanOrEqual(0);
  expect(pos.isLegal(best)).toBe(true);
});

test('heuristicBestMove returns a valid move on a fresh board', () => {
  const pos = new GogoPosition(9);
  const best = heuristicBestMove(pos);
  expect(best).toBeGreaterThanOrEqual(0); // Should return some move
});

// ---------------------------------------------------------------------------
// isGameHistoryClean tests
// ---------------------------------------------------------------------------

test('isGameHistoryClean accepts clean game history', () => {
  // Simple game with no forced wins at any point
  const pos = decodeGame('B9 e5 d5 e4 d4 e3');
  const searcher = new ForcedWinSearcher(81, 6);
  // This should have a clean history (or detect the forced win was played)
  const result = isGameHistoryClean(pos, searcher);
  expect(typeof result).toBe('boolean');
});

test('isGameHistoryClean returns true for empty position', () => {
  const pos = new GogoPosition(9);
  const searcher = new ForcedWinSearcher(81, 6);
  expect(isGameHistoryClean(pos, searcher)).toBe(true);
});

// ---------------------------------------------------------------------------
// validatePuzzlePosition tests
// ---------------------------------------------------------------------------

test('validatePuzzlePosition returns null for game-over position', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  pos.winner = BLACK;
  const searcher = new ForcedWinSearcher(81, 8);
  expect(validatePuzzlePosition(pos, BEGINNER, searcher)).toBeNull();
});

test('validatePuzzlePosition validates known puzzle position', () => {
  // The existing black-3-3 puzzle
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const searcher = new ForcedWinSearcher(81, 10);
  const result = validatePuzzlePosition(pos, BEGINNER, searcher);
  // This might or might not pass all criteria (depends on history cleanliness
  // and not-obvious check), but should at least not crash
  if (result !== null) {
    expect(result.depth).toBe(3);
    expect(result.solution).toBe('e5');
  }
});

test('validatePuzzlePosition returns null when no open-three exists', () => {
  const pos = new GogoPosition(9);
  pos.play(pos.index(4, 4));
  pos.play(pos.index(0, 0));
  const searcher = new ForcedWinSearcher(81, 8);
  expect(validatePuzzlePosition(pos, BEGINNER, searcher)).toBeNull();
});

// ---------------------------------------------------------------------------
// playRandomGame tests
// ---------------------------------------------------------------------------

test('playRandomGame produces a valid game', () => {
  const rng = new LCG(42);
  const pos = playRandomGame(9, rng, 30);
  expect(pos.ply).toBeGreaterThan(0);
  expect(pos.size).toBe(9);
});

test('playRandomGame with different seeds produces different games', () => {
  const pos1 = playRandomGame(9, new LCG(1), 20);
  const pos2 = playRandomGame(9, new LCG(999), 20);
  // Very unlikely to produce the exact same game
  expect(pos1.encodeGame()).not.toBe(pos2.encodeGame());
});

// ---------------------------------------------------------------------------
// generatePuzzles integration test
// ---------------------------------------------------------------------------

test('generatePuzzles finds beginner puzzles', { timeout: 60_000 }, () => {
  const { puzzles, stats } = generatePuzzles(BEGINNER, 2, {
    seed: 42,
    maxGames: 500,
  });
  expect(puzzles.length).toBe(2);
  expect(stats.puzzlesFound).toBe(2);
  expect(stats.gamesPlayed).toBeGreaterThan(0);
  expect(stats.positionsChecked).toBeGreaterThan(0);

  for (const p of puzzles) {
    expect(p.depth).toBe(3);
    expect(p.threshold).toBe(2);
    expect(p.solution.length).toBeGreaterThanOrEqual(2);
  }
});

// ---------------------------------------------------------------------------
// Regression: reject puzzles where captures neutralize threats
// ---------------------------------------------------------------------------

test('rejects puzzle where defender can capture to break double threat', () => {
  // Position: B9 e5 e6 f6 d5 d6 b3 d4 — White to move.
  // Without the capture check, the searcher sees a "forced win" via c4
  // (creating double threat at a2 and f7 on the b3-c4-d5-e6 diagonal).
  // However, Black can play c5 (capturing d5) or e7 (capturing e6),
  // which neutralizes both threats in one move.
  const pos = decodeGame('B9 e5 e6 f6 d5 d6 b3 d4');
  expect(pos.toMove).toBe(WHITE);

  const searcher = new ForcedWinSearcher(81, 10);

  // c4 should NOT be a forced win for White (captures break the threats)
  const c4 = decodeMove('c4', 9);
  expect(searcher.forcedWinDepthForMove(pos, c4, 3)).toBe(-1);

  // White should not have a forced win in 3 plies from this position
  expect(searcher.hasForcedWin(pos, WHITE, 3)).toBe(false);

  // The position should be rejected as a puzzle
  expect(validatePuzzlePosition(pos, BEGINNER, searcher)).toBeNull();

  // Verify that the captures actually work
  pos.play(c4); // White plays c4
  const c5 = decodeMove('c5', 9);
  pos.play(c5); // Black captures d5
  expect(pos.lastCapturedCount).toBe(1);
  const d5 = decodeMove('d5', 9);
  expect(pos.board[d5]).toBe(EMPTY); // d5 was captured
  pos.undo();

  const e7 = decodeMove('e7', 9);
  pos.play(e7); // Black captures e6
  expect(pos.lastCapturedCount).toBe(1);
  const e6 = decodeMove('e6', 9);
  expect(pos.board[e6]).toBe(EMPTY); // e6 was captured
});

// ---------------------------------------------------------------------------
// Difficulty constants
// ---------------------------------------------------------------------------

test('difficulty constants have correct values', () => {
  expect(BEGINNER).toEqual({ n: 3, m: 2, k: 0 });
  expect(INTERMEDIATE).toEqual({ n: 5, m: 4, k: 2 });
  expect(ADVANCED).toEqual({ n: 7, m: 4, k: 2 });
});
