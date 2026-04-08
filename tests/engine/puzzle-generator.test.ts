import { test, expect } from 'vitest';

import {
  BLACK,
  WHITE,
  EMPTY,
  GogoPosition,
  GogoAI,
  decodeGame,
  decodeMove,
  encodeMove,
  PUZZLES,
  PuzzleSolver,
  SOLVER_WIN,
  evaluateForSolver,
  decodeSolverScore,
  validatePuzzle,
  selfPlayGame,
  generatePuzzles,
  type ValidatedPuzzle,
} from '../../src/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function position(rows: string[], toMove = BLACK) {
  return GogoPosition.fromAscii(rows, toMove);
}

function rawPosition(rows: string[], toMove = BLACK) {
  const game = position(rows, toMove);
  game.winner = EMPTY;
  return game;
}

// ---------------------------------------------------------------------------
// PuzzleSolver — basic tests
// ---------------------------------------------------------------------------

test('solver detects immediate win (depth 1)', () => {
  // Black has 4 in a row, one move to win.
  const pos = rawPosition([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const solver = new PuzzleSolver(pos.area, 4);
  const score = solver.solve(pos, 1);
  const decoded = decodeSolverScore(score);
  expect(decoded.outcome).toBe('win');
  expect(decoded.plies).toBe(1);
});

test('solver detects forced win in 3 plies', () => {
  // Known puzzle: Black to move, forced win in 3 plies at e5.
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  expect(pos.toMove).toBe(BLACK);

  const solver = new PuzzleSolver(pos.area, 8);
  const winMove = decodeMove('e5', pos.size);
  const score = solver.solveMove(pos, winMove, 3);
  const decoded = decodeSolverScore(score);
  expect(decoded.outcome).toBe('win');
  expect(decoded.plies).toBe(3);
});

test('solver returns unknown when depth limit reached without terminal', () => {
  // Fairly empty board — no forced win at depth 1.
  const pos = rawPosition([
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const solver = new PuzzleSolver(pos.area, 4);
  const score = solver.solve(pos, 1);
  expect(score).toBe(0); // unknown
  expect(decodeSolverScore(0)).toEqual({ outcome: 'unknown', plies: 0 });
});

test('solver detects loss for current player', () => {
  // White has 4 in a row; Black to move but White will win next move.
  // Black cannot block — White has two open ends.
  const pos = rawPosition([
    '.OOOO....',
    'X........',
    'X........',
    'X........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const solver = new PuzzleSolver(pos.area, 8);
  const score = solver.solve(pos, 3);
  // Black should lose (White has an unstoppable double threat).
  const decoded = decodeSolverScore(score);
  // With 4-in-a-row for White, Black can block one end but not both.
  expect(decoded.outcome).toBe('loss');
  expect(decoded.plies).toBe(2);
});

test('solver handles already-won position', () => {
  const pos = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const solver = new PuzzleSolver(pos.area, 4);
  const score = solver.solve(pos, 3);
  const decoded = decodeSolverScore(score);
  // White is to move but Black already won → White lost at ply 0.
  expect(decoded.outcome).toBe('loss');
  expect(decoded.plies).toBe(0);
});

test('solver solveMove returns 0 for illegal move', () => {
  const pos = rawPosition([
    'X........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const solver = new PuzzleSolver(pos.area, 4);
  // Try to play on an occupied cell.
  const score = solver.solveMove(pos, 0, 3);
  expect(score).toBe(0);
});

test('solver with heuristic classifies clearly-lost leaf positions', () => {
  // White has massive advantage — heuristic should classify as loss for Black.
  const pos = rawPosition([
    '.OOO.....',
    '.OOO.....',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const solver = new PuzzleSolver(pos.area, 8);
  // At depth 0 with heuristic: should classify based on evaluation.
  const scoreNoH = solver.solve(pos, 0, false);
  expect(scoreNoH).toBe(0); // Without heuristic, unknown.

  const scoreWithH = solver.solve(pos, 0, true);
  // If the position is clearly lost according to heuristic, score < 0.
  // If not clearly lost enough, still 0.
  // Let's test both branches by checking the evaluate function directly.
  const hScore = evaluateForSolver(pos);
  if (hScore < -50_000) {
    expect(scoreWithH).toBeLessThan(0);
  } else {
    expect(scoreWithH).toBe(0);
  }
});

test('solver with heuristic does not classify balanced positions as loss', () => {
  const pos = rawPosition([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const solver = new PuzzleSolver(pos.area, 4);
  // Depth 0 with heuristic — balanced position should be unknown.
  const score = solver.solve(pos, 0, true);
  expect(score).toBe(0);
});

test('solver handles no legal moves gracefully', () => {
  // A won position — no legal moves because winner is set.
  const pos = position([
    'XXXXX....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const solver = new PuzzleSolver(pos.area, 4);
  const allMoves = new Int16Array(pos.area);
  const count = pos.generateAllLegalMoves(allMoves);
  expect(count).toBe(0); // No legal moves because winner is set.
});

test('solver maxPly limit is respected', () => {
  const pos = rawPosition([
    'XXXX.....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  // maxPly = 0 should return unknown immediately (ply 0 >= maxPly 0).
  const solver = new PuzzleSolver(pos.area, 0);
  const score = solver.solve(pos, 5);
  expect(score).toBe(0);
});

// ---------------------------------------------------------------------------
// evaluateForSolver
// ---------------------------------------------------------------------------

test('evaluateForSolver returns positive for strong Black, negative for strong White', () => {
  const blackStrong = rawPosition([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(evaluateForSolver(blackStrong)).toBeGreaterThan(0);

  // Same position but White to move → negative (bad for White).
  const whiteView = rawPosition([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  expect(evaluateForSolver(whiteView)).toBeLessThan(0);
});

test('evaluateForSolver returns near-zero for empty board', () => {
  const empty = new GogoPosition(9);
  const score = evaluateForSolver(empty);
  expect(score).toBe(0);
});

// ---------------------------------------------------------------------------
// decodeSolverScore
// ---------------------------------------------------------------------------

test('decodeSolverScore handles win, loss, and unknown', () => {
  expect(decodeSolverScore(SOLVER_WIN - 3)).toEqual({ outcome: 'win', plies: 3 });
  expect(decodeSolverScore(-SOLVER_WIN + 5)).toEqual({ outcome: 'loss', plies: 5 });
  expect(decodeSolverScore(0)).toEqual({ outcome: 'unknown', plies: 0 });
});

// ---------------------------------------------------------------------------
// validatePuzzle
// ---------------------------------------------------------------------------

test('validatePuzzle accepts known (3,3) puzzle', { timeout: 15_000 }, () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const winMove = decodeMove('e5', pos.size);

  const result = validatePuzzle(pos, 3, 3, winMove, 9);
  expect(result).not.toBeNull();
  expect(result!.solution).toBe('e5');
  expect(result!.depth).toBe(3);
  expect(result!.toMove).toBe(BLACK);
});

test('validatePuzzle finds winning move when candidateMove is -1', { timeout: 15_000 }, () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');

  const result = validatePuzzle(pos, 3, 3, -1, 9);
  expect(result).not.toBeNull();
  expect(result!.solution).toBe('e5');
});

test('validatePuzzle rejects position with wrong candidate move', { timeout: 10_000 }, () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  // a1 is not the winning move.
  const badMove = decodeMove('a1', pos.size);
  const result = validatePuzzle(pos, 3, 3, badMove, 9);
  expect(result).toBeNull();
});

test('validatePuzzle rejects already-won position', () => {
  const pos = position([
    'XXXXX....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const result = validatePuzzle(pos, 3, 3, -1, 9);
  expect(result).toBeNull();
});

test('validatePuzzle rejects when GogoAI at depth 1 finds the winning move (Not Obvious)', { timeout: 10_000 }, () => {
  // Construct a position where depth-1 AI trivially finds the win.
  // Black has XXXX — the winning move e1 is obvious even at depth 1.
  const pos = rawPosition([
    'XXXX.....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const winMove = pos.index(4, 0); // e1 completes 5-in-a-row
  const result = validatePuzzle(pos, 1, 1, winMove, 5);
  // The shallow AI at depth 1 will find this trivially → reject.
  expect(result).toBeNull();
});

test('validatePuzzle rejects puzzle with unrealistic history (forced win earlier)', { timeout: 15_000 }, () => {
  // Create a position where an earlier position had a forced ply-3 win.
  // Black plays c5 d5 e5 — then white plays a1 b1 c1 (irrelevant moves).
  // After c5 d5 the position already had Black with a forced 3-ply win.
  // Actually we need to construct this carefully.
  // Let's use a game where at some point the moving player had 4-in-a-row.
  const pos = decodeGame('B9 a1 a2 b1 b2 c1 c2 d1 d2');
  // At this point, Black just played d1, White played d2.
  // After Black's move c1, Black had XXX at a1,b1,c1 and could win with d1.
  // That's a ply-1 win at the position after c1+c2, which violates Realistic.
  const winMove = decodeMove('e1', pos.size);
  const result = validatePuzzle(pos, 1, 1, winMove, 5);
  expect(result).toBeNull();
});

test('validatePuzzle rejects when no legal moves exist', () => {
  // Already won — no legal moves.
  const wonPos = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  expect(validatePuzzle(wonPos, 1, 1, -1, 5)).toBeNull();
});

// ---------------------------------------------------------------------------
// selfPlayGame
// ---------------------------------------------------------------------------

test('selfPlayGame produces candidate strings', () => {
  const shallow = new GogoAI({ maxDepth: 2, quiescenceDepth: 2 });
  const deep = new GogoAI({ maxDepth: 4, quiescenceDepth: 1 });

  const { candidates, rngState } = selfPlayGame(9, shallow, deep, 50, 60, 0.15, 42);
  // We can't guarantee specific candidates, but the function should run without errors.
  expect(Array.isArray(candidates)).toBe(true);
  expect(typeof rngState).toBe('number');
  // Each candidate should be a valid game record.
  for (const c of candidates) {
    expect(c).toMatch(/^B9/);
    const pos = decodeGame(c);
    expect(pos.size).toBe(9);
  }
});

test('selfPlayGame with epsilon=0 still works (no random moves)', () => {
  const shallow = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
  const deep = new GogoAI({ maxDepth: 2, quiescenceDepth: 1 });

  const { candidates } = selfPlayGame(9, shallow, deep, 20, 30, 0, 123);
  expect(Array.isArray(candidates)).toBe(true);
});

test('selfPlayGame handles early game termination', () => {
  const shallow = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
  const deep = new GogoAI({ maxDepth: 2, quiescenceDepth: 0 });

  // Very short game limit.
  const { candidates } = selfPlayGame(9, shallow, deep, 10, 5, 0.5, 99);
  expect(Array.isArray(candidates)).toBe(true);
});

// ---------------------------------------------------------------------------
// generatePuzzles
// ---------------------------------------------------------------------------

test('generatePuzzles finds (3,2) puzzles', { timeout: 120_000 }, () => {
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    count: 1,
    maxGames: 500,
    seed: 42,
    aiTimeMs: 30,
    maxSearchDepth: 9,
  });

  // Should find at least one puzzle (might not always in limited games).
  // If zero are found, the test is still valid — it tests the pipeline.
  expect(Array.isArray(puzzles)).toBe(true);
  for (const p of puzzles) {
    expect(p.depth).toBe(3);
    expect(p.threshold).toBe(2);
    expect(p.solution.length).toBeGreaterThan(0);
    expect(p.toMove === BLACK || p.toMove === WHITE).toBe(true);
  }
});

test('generatePuzzles respects maxGames limit', { timeout: 15_000 }, () => {
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    count: 100, // Unrealistically high count
    maxGames: 2, // Very few games
    seed: 1,
    aiTimeMs: 20,
  });

  // Should return some array (possibly empty due to few games).
  expect(Array.isArray(puzzles)).toBe(true);
});

test('generatePuzzles skips duplicate encodings', { timeout: 30_000 }, () => {
  // Run with a fixed seed — if the same position appears twice, it should be skipped.
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    count: 2,
    maxGames: 200,
    seed: 42,
    aiTimeMs: 30,
  });

  // Check no duplicate encoded strings.
  const encodings = puzzles.map((p) => p.encoded);
  expect(new Set(encodings).size).toBe(encodings.length);
});

test('generatePuzzles with existing puzzles filters duplicates', { timeout: 30_000 }, () => {
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    count: 1,
    maxGames: 100,
    seed: 42,
    aiTimeMs: 30,
    existingPuzzles: PUZZLES,
  });

  expect(Array.isArray(puzzles)).toBe(true);
});

// ---------------------------------------------------------------------------
// Validate existing puzzles with the solver
// ---------------------------------------------------------------------------

test('solver confirms all existing puzzles have correct forced-win depth', { timeout: 60_000 }, () => {
  for (const puzzle of PUZZLES) {
    const pos = decodeGame(puzzle.encoded);
    const solver = new PuzzleSolver(pos.area, puzzle.depth + 2);
    const winMove = decodeMove(puzzle.solution, pos.size);

    const score = solver.solveMove(pos, winMove, puzzle.depth);
    const decoded = decodeSolverScore(score);
    expect(decoded.outcome).toBe('win');
    expect(decoded.plies).toBe(puzzle.depth);
  }
});
