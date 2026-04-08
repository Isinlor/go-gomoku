import { test, expect } from 'vitest';

import {
  BLACK,
  WHITE,
  EMPTY,
  GogoPosition,
  GogoAI,
  decodeGame,
  decodeMove,
  PUZZLES,
  PuzzleSolver,
  SOLVER_WIN,
  evaluateForSolver,
  decodeSolverScore,
  validatePuzzle,
  selfPlayGame,
  generatePuzzles,
} from '../../src/engine';

function position(rows: string[], toMove = BLACK) {
  return GogoPosition.fromAscii(rows, toMove);
}

function rawPosition(rows: string[], toMove = BLACK) {
  const game = position(rows, toMove);
  game.winner = EMPTY;
  return game;
}

// ---------------------------------------------------------------------------
// decodeSolverScore
// ---------------------------------------------------------------------------

test('decodeSolverScore handles win, loss, and unknown', () => {
  expect(decodeSolverScore(SOLVER_WIN - 3)).toEqual({ outcome: 'win', plies: 3 });
  expect(decodeSolverScore(-SOLVER_WIN + 5)).toEqual({ outcome: 'loss', plies: 5 });
  expect(decodeSolverScore(0)).toEqual({ outcome: 'unknown', plies: 0 });
});

// ---------------------------------------------------------------------------
// PuzzleSolver
// ---------------------------------------------------------------------------

test('solver detects immediate win', () => {
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
  const solver = new PuzzleSolver(pos.area, 4);
  const d = decodeSolverScore(solver.solve(pos, 1));
  expect(d.outcome).toBe('win');
  expect(d.plies).toBe(1);
});

test('solver detects forced win in 3 plies', () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const solver = new PuzzleSolver(pos.area, 8);
  const d = decodeSolverScore(solver.solveMove(pos, decodeMove('e5', pos.size), 3));
  expect(d.outcome).toBe('win');
  expect(d.plies).toBe(3);
});

test('solver detects loss (opponent double threat)', () => {
  const pos = rawPosition([
    '.OOOO....',
    'XXX......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const solver = new PuzzleSolver(pos.area, 8);
  const d = decodeSolverScore(solver.solve(pos, 3));
  expect(d.outcome).toBe('loss');
  expect(d.plies).toBe(2);
});

test('solver returns unknown at depth limit', () => {
  const pos = rawPosition([
    '.........',
    '.........',
    '.........',
    '....X....',
    '....O....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const solver = new PuzzleSolver(pos.area, 4);
  expect(solver.solve(pos, 1)).toBe(0);
});

test('solver handles already-won position', () => {
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
  const d = decodeSolverScore(solver.solve(pos, 3));
  expect(d.outcome).toBe('loss');
  expect(d.plies).toBe(0);
});

test('solver solveMove returns 0 for illegal move', () => {
  const pos = rawPosition(['X........', 'O........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], BLACK);
  expect(new PuzzleSolver(pos.area, 4).solveMove(pos, 0, 3)).toBe(0);
});

test('solver respects maxPly limit', () => {
  const pos = rawPosition(['XXXX.....', 'OOO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], BLACK);
  expect(new PuzzleSolver(pos.area, 0).solve(pos, 5)).toBe(0);
});

test('solver with heuristic classifies clearly-lost leaves', () => {
  const pos = rawPosition(['.OOO.....', '.OOO.....', '.OOO.....', '.........', '....X....', '.........', '.........', '.........', '.........'], BLACK);
  const solver = new PuzzleSolver(pos.area, 4);
  expect(solver.solve(pos, 0, false)).toBe(0);
  const h = evaluateForSolver(pos);
  const withH = solver.solve(pos, 0, true);
  if (h < -50_000) {
    expect(withH).toBeLessThan(0);
  } else {
    expect(withH).toBe(0);
  }
});

test('solver with heuristic leaves balanced positions unknown', () => {
  const pos = rawPosition(['.........', '.........', '.........', '....X....', '....O....', '.........', '.........', '.........', '.........'], BLACK);
  expect(new PuzzleSolver(pos.area, 4).solve(pos, 0, true)).toBe(0);
});

test('solver empty board returns 0', () => {
  const empty = new GogoPosition(9);
  expect(new PuzzleSolver(empty.area, 4).solve(empty, 3)).toBe(0);
});

test('solver confirms forced-win depths for existing puzzles', { timeout: 60_000 }, () => {
  for (const puzzle of PUZZLES) {
    const pos = decodeGame(puzzle.encoded);
    const solver = new PuzzleSolver(pos.area, puzzle.depth + 2);
    const winMove = decodeMove(puzzle.solution, pos.size);
    const d = decodeSolverScore(solver.solveMove(pos, winMove, puzzle.depth));
    expect(d.outcome).toBe('win');
    expect(d.plies).toBe(puzzle.depth);
  }
});

// ---------------------------------------------------------------------------
// evaluateForSolver
// ---------------------------------------------------------------------------

test('evaluateForSolver signs and empty board', () => {
  const pos = rawPosition(['XXXX.....', 'O........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], BLACK);
  expect(evaluateForSolver(pos)).toBeGreaterThan(0);
  pos.toMove = WHITE;
  expect(evaluateForSolver(pos)).toBeLessThan(0);
  expect(evaluateForSolver(new GogoPosition(9))).toBe(0);
});

// ---------------------------------------------------------------------------
// validatePuzzle
// ---------------------------------------------------------------------------

test('validatePuzzle rejects already-won position', () => {
  const p = position(['XXXXX....', 'OOO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], WHITE);
  expect(validatePuzzle(p, 1, 1, -1, 5)).toBeNull();
});

test('validatePuzzle rejects bad candidate move', () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  expect(validatePuzzle(pos, 3, 3, decodeMove('a2', pos.size), 7)).toBeNull();
});

test('validatePuzzle rejects obvious solutions', () => {
  const pos = rawPosition(['XXXX.....', 'OOO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], BLACK);
  expect(validatePuzzle(pos, 1, 1, pos.index(4, 0), 5)).toBeNull();
});

test('validatePuzzle rejects multiple winning moves with candidate=-1', () => {
  const pos = rawPosition(['XXXX.....', '.........', '.........', '.........', '....XXXX.', 'OOO..OOO.', '.........', '.........', '.........'], BLACK);
  expect(validatePuzzle(pos, 1, 1, -1, 3)).toBeNull();
});

test('validatePuzzle rejects uniqueness violation in step 3', () => {
  const pos = rawPosition(['XXXX.....', '.........', '.........', '.........', '....XXXX.', 'OOO..OOO.', '.........', '.........', '.........'], BLACK);
  expect(validatePuzzle(pos, 1, 1, pos.index(4, 0), 3)).toBeNull();
});

test('validatePuzzle rejects unrealistic history', () => {
  const pos = decodeGame('B9 a1 a2 b1 b2 c1 c2 d1 d2');
  expect(validatePuzzle(pos, 1, 1, decodeMove('e1', pos.size), 5)).toBeNull();
});

test('validatePuzzle rejects when threshold too high', { timeout: 15_000 }, () => {
  // Use known puzzle position; Not Obvious passes for depth 7 puzzles.
  const p = PUZZLES.find(x => x.id === 'black-7-5')!;
  const pos = decodeGame(p.encoded);
  const winMove = decodeMove(p.solution, pos.size);
  // Threshold 99 is impossible to satisfy.
  expect(validatePuzzle(pos, 7, 99, winMove, 11)).toBeNull();
});

// ---------------------------------------------------------------------------
// selfPlayGame
// ---------------------------------------------------------------------------

test('selfPlayGame produces candidates', { timeout: 10_000 }, () => {
  const shallow = new GogoAI({ maxDepth: 1, quiescenceDepth: 1 });
  const deep = new GogoAI({ maxDepth: 3, quiescenceDepth: 1 });
  const { candidates, rngState } = selfPlayGame(9, shallow, deep, 20, 40, 0.15, 42);
  expect(Array.isArray(candidates)).toBe(true);
  expect(typeof rngState).toBe('number');
  for (const c of candidates) expect(c).toMatch(/^B9/);
});

test('selfPlayGame with epsilon=0', { timeout: 10_000 }, () => {
  const shallow = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
  const deep = new GogoAI({ maxDepth: 2, quiescenceDepth: 1 });
  const { candidates } = selfPlayGame(9, shallow, deep, 10, 20, 0, 123);
  expect(Array.isArray(candidates)).toBe(true);
});

test('selfPlayGame short game', { timeout: 10_000 }, () => {
  const shallow = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
  const deep = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
  const { candidates } = selfPlayGame(9, shallow, deep, 5, 5, 0.5, 99);
  expect(Array.isArray(candidates)).toBe(true);
});

// ---------------------------------------------------------------------------
// generatePuzzles
// ---------------------------------------------------------------------------

test('generatePuzzles pipeline runs', { timeout: 15_000 }, () => {
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    count: 1,
    maxGames: 3,
    seed: 42,
    aiTimeMs: 10,
    maxSearchDepth: 5,
    shallowDepth: 1,
    shallowQuiescence: 1,
    deepDepth: 3,
    deepQuiescence: 1,
  });
  expect(Array.isArray(puzzles)).toBe(true);
});

test('generatePuzzles respects maxGames and defaults', { timeout: 15_000 }, () => {
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    maxGames: 1,
  });
  expect(Array.isArray(puzzles)).toBe(true);
});

test('generatePuzzles with existingPuzzles', { timeout: 15_000 }, () => {
  const puzzles = generatePuzzles({
    targetDepth: 3,
    targetThreshold: 2,
    count: 1,
    maxGames: 3,
    seed: 42,
    aiTimeMs: 10,
    shallowDepth: 1,
    shallowQuiescence: 1,
    deepDepth: 3,
    deepQuiescence: 1,
    existingPuzzles: PUZZLES,
  });
  expect(Array.isArray(puzzles)).toBe(true);
});
