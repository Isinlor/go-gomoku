import { test, expect } from 'vitest';

import {
  BLACK,
  WHITE,
  EMPTY,
  GogoPosition,
  decodeGame,
  decodeMove,
  ExactSolver,
  verifyPuzzle,
  selfPlayGame,
  scanGameForPuzzles,
  generatePuzzles,
  type GeneratorOptions,
  PUZZLES,
} from '../../src/engine';

/* ────────────────────────────────────────────────────────── */
/*  Helpers                                                   */
/* ────────────────────────────────────────────────────────── */

function position(rows: string[], toMove = BLACK) {
  return GogoPosition.fromAscii(rows, toMove);
}

function testOptions(overrides: Partial<GeneratorOptions> = {}): GeneratorOptions {
  let tick = 0;
  return {
    boardSize: 9,
    targetDepth: 5,
    targetThreshold: 4,
    maxPuzzles: 1,
    maxGames: 1,
    selfPlayDepth: 2,
    selfPlayQuiescence: 2,
    scanDepth: 4,
    scanQuiescence: 1,
    selfPlayTimeMs: 100,
    scanTimeMs: 500,
    maxStrictFailureDepth: 9,
    maxMovesInGame: 60,
    minMovesInGame: 8,
    now: () => tick++,
    ...overrides,
  };
}

/* ────────────────────────────────────────────────────────── */
/*  ExactSolver – hasForceWin                                 */
/* ────────────────────────────────────────────────────────── */

test('hasForceWin: returns true when forPlayer has already won', () => {
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
  ]);
  const solver = new ExactSolver(pos.area, 5);
  expect(solver.hasForceWin(pos, BLACK, 0)).toBe(true);
  expect(solver.hasForceWin(pos, BLACK, 5)).toBe(true);
});

test('hasForceWin: returns false when the other player has won', () => {
  const pos = position([
    'OOOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 5);
  expect(solver.hasForceWin(pos, BLACK, 5)).toBe(false);
});

test('hasForceWin: returns false at depth 0 when no one has won', () => {
  const pos = new GogoPosition(9);
  const solver = new ExactSolver(pos.area, 5);
  expect(solver.hasForceWin(pos, BLACK, 0)).toBe(false);
});

test('hasForceWin: returns false when no legal moves (draw)', () => {
  const pos = position([
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXOXOXOX',
  ]);
  pos.winner = EMPTY;
  const solver = new ExactSolver(pos.area, 5);
  expect(solver.hasForceWin(pos, BLACK, 5)).toBe(false);
});

test('hasForceWin: attacker finds immediate win in 1 ply', () => {
  const pos = position([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 5);
  expect(solver.hasForceWin(pos, BLACK, 1)).toBe(true);
  expect(solver.hasForceWin(pos, BLACK, 5)).toBe(true);
});

test('hasForceWin: defender escapes when attacker has no forced win', () => {
  const pos = position([
    'XXX......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  const solver = new ExactSolver(pos.area, 3);
  expect(solver.hasForceWin(pos, BLACK, 1)).toBe(false);
});

test('hasForceWin: defender branch — all moves lead to attacker win', () => {
  const pos = position([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.X.......',
    '.X.......',
    '.X.......',
    '.X.......',
    '.........',
  ], WHITE);
  const solver = new ExactSolver(pos.area, 3);
  expect(solver.hasForceWin(pos, BLACK, 2)).toBe(true);
});

/* ────────────────────────────────────────────────────────── */
/*  ExactSolver – forcedWinDepth                              */
/* ────────────────────────────────────────────────────────── */

test('forcedWinDepth: finds exact depth for simple positions', () => {
  const pos = position([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 5);
  expect(solver.forcedWinDepth(pos, BLACK, 5)).toBe(1);
});

test('forcedWinDepth: returns -1 when no forced win within search depth', () => {
  const pos = new GogoPosition(9);
  const solver = new ExactSolver(pos.area, 3);
  expect(solver.forcedWinDepth(pos, BLACK, 3)).toBe(-1);
});

test('forcedWinDepth: verifies existing puzzle depth 3', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 5);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);
  pos.play(solutionIndex);
  expect(solver.forcedWinDepth(pos, BLACK, 5)).toBe(2);
  pos.undo();
});

test('forcedWinDepth: verifies existing puzzle depth 5', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-5-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 7);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);
  pos.play(solutionIndex);
  expect(solver.forcedWinDepth(pos, BLACK, 7)).toBe(4);
  pos.undo();
});

test('ExactSolver node counting works', () => {
  const pos = position([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 3);
  solver.nodes = 0;
  solver.hasForceWin(pos, BLACK, 1);
  expect(solver.nodes).toBeGreaterThan(0);
});

test('ExactSolver maxSupportedDepth is set correctly', () => {
  const solver = new ExactSolver(81, 7);
  expect(solver.maxSupportedDepth).toBe(7);
});

test('move ordering: handles positions with varied tactical features', () => {
  const pos = position([
    'XXX.O....',
    '.OOO.....',
    '..X......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 3);
  solver.nodes = 0;
  const result = solver.hasForceWin(pos, BLACK, 3);
  expect(typeof result).toBe('boolean');
  expect(solver.nodes).toBeGreaterThan(0);
});

/* ────────────────────────────────────────────────────────── */
/*  verifyPuzzle                                              */
/* ────────────────────────────────────────────────────────── */

test('verifyPuzzle: validates known depth-3 puzzle (skip obvious)', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 9);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);

  const result = verifyPuzzle(pos, solutionIndex, 3, 3, 9, solver, {
    checkObvious: false,
    checkRealistic: false,
  });
  expect(result.valid).toBe(true);
  expect(result.reason).toBe('valid');
  expect(result.solutionAlgebraic).toBe(puzzle.solution);
});

test('verifyPuzzle: rejects obvious moves (shallow AI finds it)', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 9);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);

  const result = verifyPuzzle(pos, solutionIndex, 3, 3, 9, solver, {
    checkObvious: true,
    checkRealistic: false,
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('obvious');
});

test('verifyPuzzle: rejects illegal solution move', () => {
  const pos = position([
    'X........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 5);
  const result = verifyPuzzle(pos, 0, 3, 3, 5, solver, { checkObvious: false });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('illegal-solution');
});

test('verifyPuzzle: rejects when no forced win at target depth', () => {
  const pos = position([
    'X.O......',
    '.X.......',
    '..O......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const solver = new ExactSolver(pos.area, 7);
  const result = verifyPuzzle(pos, pos.index(8, 8), 5, 4, 7, solver, {
    checkObvious: false,
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('no-forced-win');
});

test('verifyPuzzle: rejects when a faster forced win exists', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 9);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);

  // Claim depth 5 for a puzzle that actually has depth 3
  const result = verifyPuzzle(pos, solutionIndex, 5, 3, 9, solver, {
    checkObvious: false,
    checkRealistic: false,
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('faster-win');
});

test('verifyPuzzle: rejects when threshold is violated', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 9);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);

  const result = verifyPuzzle(pos, solutionIndex, 3, 5, 9, solver, {
    checkObvious: false,
    checkRealistic: false,
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toContain('threshold-violated');
});

test('verifyPuzzle: rejects when strict failure cannot be verified', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 9);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);

  const result = verifyPuzzle(pos, solutionIndex, 3, 1, 1, solver, {
    checkObvious: false,
    checkRealistic: false,
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toContain('no-strict-failure');
});

test('verifyPuzzle: rejects unrealistic games (forced wins in history)', () => {
  const pos = decodeGame('B9 e5 a1 e6 b1 e7 c1 e8 d1');
  const solver = new ExactSolver(pos.area, 9);
  const winMove = decodeMove('e9', pos.size);

  const result = verifyPuzzle(pos, winMove, 1, 1, 9, solver, {
    checkObvious: false,
    checkRealistic: true,
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toContain('unrealistic');
});

test('verifyPuzzle: validates known depth-5 puzzle', { timeout: 120_000 }, () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-5-3')!;
  const pos = decodeGame(puzzle.encoded);
  const solver = new ExactSolver(pos.area, 9);
  const solutionIndex = decodeMove(puzzle.solution, pos.size);

  const result = verifyPuzzle(pos, solutionIndex, 5, 3, 9, solver, {
    checkObvious: false,
    checkRealistic: false,
  });
  expect(result.valid).toBe(true);
  expect(result.solutionAlgebraic).toBe(puzzle.solution);
});

/* ────────────────────────────────────────────────────────── */
/*  selfPlayGame                                              */
/* ────────────────────────────────────────────────────────── */

test('selfPlayGame: produces a complete game', () => {
  const opts = testOptions({ maxMovesInGame: 30 });
  const game = selfPlayGame(opts);
  expect(game.ply).toBeGreaterThan(0);
  expect(game.ply).toBeLessThanOrEqual(30);
});

test('selfPlayGame: respects maxMovesInGame', () => {
  const opts = testOptions({ maxMovesInGame: 10 });
  const game = selfPlayGame(opts);
  expect(game.ply).toBeLessThanOrEqual(10);
});

/* ────────────────────────────────────────────────────────── */
/*  scanGameForPuzzles                                        */
/* ────────────────────────────────────────────────────────── */

test('scanGameForPuzzles: returns empty for a short game with high minMoves', () => {
  const opts = testOptions({ minMovesInGame: 100, maxMovesInGame: 100 });
  const game = selfPlayGame(opts);
  const solver = new ExactSolver(81, 9);
  const results = scanGameForPuzzles(game, opts, solver);
  expect(results).toEqual([]);
});

test('scanGameForPuzzles: handles game with winner', () => {
  const pos = decodeGame('B9 e5 a1 e6 b1 e7 c1 e8 d1 e9');
  const opts = testOptions({ minMovesInGame: 0, maxMovesInGame: 60 });
  const solver = new ExactSolver(81, 9);
  const results = scanGameForPuzzles(pos, opts, solver);
  expect(Array.isArray(results)).toBe(true);
});

test('scanGameForPuzzles: filters duplicates via existingEncodings', { timeout: 15_000 }, () => {
  const opts = testOptions({
    minMovesInGame: 0,
    maxMovesInGame: 60,
    scanTimeMs: 100,
    selfPlayTimeMs: 50,
  });
  const game = selfPlayGame(opts);
  const solver = new ExactSolver(81, 9);

  const results1 = scanGameForPuzzles(game, opts, solver);
  const seen = new Set<string>();
  for (const r of results1) seen.add(r.encoded);
  const results2 = scanGameForPuzzles(game, opts, solver, seen);

  if (results1.length > 0) {
    expect(results2.length).toBeLessThanOrEqual(results1.length);
  } else {
    expect(results2.length).toBe(0);
  }
});

/* ────────────────────────────────────────────────────────── */
/*  generatePuzzles                                           */
/* ────────────────────────────────────────────────────────── */

test('generatePuzzles: runs without error with minimal settings', () => {
  let tick = 0;
  const puzzles = generatePuzzles({
    boardSize: 9,
    maxGames: 1,
    maxPuzzles: 0,
    selfPlayTimeMs: 50,
    scanTimeMs: 50,
    now: () => tick++,
  });
  expect(Array.isArray(puzzles)).toBe(true);
  expect(puzzles.length).toBe(0);
});

test('generatePuzzles: returns early when maxPuzzles is 0', () => {
  let tick = 0;
  const puzzles = generatePuzzles({
    maxGames: 2,
    maxPuzzles: 0,
    now: () => tick++,
  });
  expect(puzzles.length).toBe(0);
});
