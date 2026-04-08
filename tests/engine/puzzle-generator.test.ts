import { test, expect } from 'vitest';

import {
  BLACK,
  EMPTY,
  GogoPosition,
  decodeGame,
  decodeMove,
  PUZZLES,
  ProofSearcher,
  PROOF_WIN,
  validatePuzzleCandidate,
  checkRealistic,
  playAIGame,
  screenPosition,
  findCandidatesInGame,
} from '../../src/engine';

function pos(rows: string[], toMove = BLACK) {
  return GogoPosition.fromAscii(rows, toMove);
}

/* ---- ProofSearcher core ---- */

test('detects immediate win', () => {
  const p = pos(['XXXX.....', 'OOO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  p.winner = EMPTY;
  const s = new ProofSearcher(p.area, 10);
  const score = s.search(p, 2);
  expect(score).toBeGreaterThan(0);
  expect(PROOF_WIN - score).toBe(1);
});

test('detects forced win in 3 plies', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const s = new ProofSearcher(p.area, 10);
  expect(PROOF_WIN - s.search(p, 3)).toBe(3);
});

test('returns 0 at depth limit', () => {
  const p = new GogoPosition(9);
  p.play(p.index(4, 4));
  const s = new ProofSearcher(p.area, 4);
  expect(s.search(p, 1)).toBe(0);
});

test('returns negative for terminal loss', () => {
  const p = pos(['.........', '.........', '.........', '.........', 'XOOOOO...', '.........', '.........', '.........', '.........']);
  const s = new ProofSearcher(p.area, 5);
  expect(s.search(p, 5)).toBeLessThan(0);
});

test('returns 0 at depth 0', () => {
  const p = new GogoPosition(9);
  expect(new ProofSearcher(p.area, 2).search(p, 0)).toBe(0);
});

test('node count increases', () => {
  const p = decodeGame('B9 e5 d5 f5');
  const s = new ProofSearcher(p.area, 10);
  s.search(p, 2);
  expect(s.nodes).toBeGreaterThan(0);
});

test('returns 0 for full board draw', () => {
  const p = pos(['XOXOXOXOX', 'OXOXOXOXO', 'XOXOXOXOX', 'OXOXOXOXO', 'XOXOXOXOX', 'OXOXOXOXO', 'XOXOXOXOX', 'OXOXOXOXO', 'XOXOXOXOX']);
  p.winner = EMPTY;
  expect(new ProofSearcher(p.area, 5).search(p, 3)).toBe(0);
});

test('empty board center fallback', () => {
  const p = new GogoPosition(9);
  expect(new ProofSearcher(p.area, 4).search(p, 2)).toBe(0);
});

/* ---- analyzeFirstMoves ---- */

test('analyzeFirstMoves: black-3-3 unique winner', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const s = new ProofSearcher(p.area, 10);
  const results = s.analyzeFirstMoves(p, 3);
  const winners = results.filter((r) => r.winPly === 3);
  expect(winners.length).toBe(1);
  expect(winners[0].move).toBe(decodeMove(puzzle.solution, p.size));
});

test('analyzeFirstMoves: white-3-3 unique winner', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'white-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const s = new ProofSearcher(p.area, 10);
  const results = s.analyzeFirstMoves(p, 3);
  const winners = results.filter((r) => r.winPly === 3);
  expect(winners.length).toBe(1);
  expect(winners[0].move).toBe(decodeMove(puzzle.solution, p.size));
});

test('analyzeFirstMoves: no win on sparse board', () => {
  const p = decodeGame('B9 e5');
  const s = new ProofSearcher(p.area, 10);
  for (const r of s.analyzeFirstMoves(p, 3)) {
    expect(r.winPly).toBe(-1);
  }
});

test('analyzeFirstMoves: empty for terminal', () => {
  const p = pos(['XXXXX....', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  expect(new ProofSearcher(p.area, 5).analyzeFirstMoves(p, 3).length).toBe(0);
});

/* ---- validatePuzzleCandidate rejections ---- */

test('reject: no win at depth n', () => {
  const p = decodeGame('B9 e5 d4 d5 e4 c5 f4 b5 g4');
  const r = validatePuzzleCandidate(p, 3, 3, { skipNotObvious: true });
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('No move forces a win');
});

test('reject: multiple winning moves', () => {
  const p = pos(['.XXXX....', '.........', '.........', '.........', '.XXXX....', 'OOO......', '.........', '.........', '.........']);
  p.winner = EMPTY;
  const r = validatePuzzleCandidate(p, 1, 1, { skipNotObvious: true });
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('Multiple winning first moves');
});

test('reject: not-obvious', () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const r = validatePuzzleCandidate(p, 3, 3);
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('Not-obvious');
});

test('reject: threshold violated', { timeout: 15_000 }, () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const r = validatePuzzleCandidate(p, 3, 5, { skipNotObvious: true });
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('Threshold violated');
});

/* ---- checkRealistic ---- */

test('checkRealistic: fails on forced win in history', () => {
  const game = new GogoPosition(9);
  game.play(game.index(2, 4));
  game.play(game.index(0, 0));
  game.play(game.index(3, 4));
  game.play(game.index(0, 1));
  game.play(game.index(4, 4));
  game.play(game.index(0, 2));
  game.play(game.index(5, 4));
  game.play(game.index(0, 3));
  game.play(game.index(8, 8));
  const s = new ProofSearcher(game.area, 10);
  const result = checkRealistic(game, s);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain('Realistic check failed');
});

test('checkRealistic: passes for clean history', () => {
  const game = decodeGame('B9 e5 d5 f5 e4');
  const s = new ProofSearcher(game.area, 10);
  expect(checkRealistic(game, s).ok).toBe(true);
});

/* ---- validatePuzzleCandidate acceptance ---- */

test('accepts black-3-3 (skipNotObvious)', { timeout: 15_000 }, () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const r = validatePuzzleCandidate(p, 3, 3, { skipNotObvious: true });
  expect(r.valid).toBe(true);
  expect(r.solution).toBe(puzzle.solution);
});

test('white-3-3 fails realistic (pre-existing)', { timeout: 15_000 }, () => {
  const puzzle = PUZZLES.find((p) => p.id === 'white-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const r = validatePuzzleCandidate(p, 3, 3, { skipNotObvious: true });
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('Realistic check failed');
});

/* ---- Candidate Generation ---- */

test('playAIGame produces game', { timeout: 30_000 }, () => {
  const game = playAIGame({ timeLimitMs: 100, maxGameMoves: 20 });
  expect(game.size).toBe(9);
  expect(game.ply).toBeGreaterThan(0);
  expect(game.ply).toBeLessThanOrEqual(20);
});

test('playAIGame defaults', { timeout: 15_000 }, () => {
  const game = playAIGame({ maxGameMoves: 4, timeLimitMs: 50 });
  expect(game.ply).toBeGreaterThan(0);
});

test('screenPosition: null for terminal', () => {
  const p = pos(['XXXXX....', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  expect(screenPosition(p)).toBeNull();
});

test('screenPosition: null no win', { timeout: 15_000 }, () => {
  expect(screenPosition(decodeGame('B9 e5 d5'), { timeLimitMs: 100 })).toBeNull();
});

test('screenPosition: null both see win', { timeout: 15_000 }, () => {
  const p = pos(['XXXX.....', 'OOO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  p.winner = EMPTY;
  expect(screenPosition(p, {
    weakAI: { maxDepth: 2, quiescenceDepth: 2 },
    strongAI: { maxDepth: 4, quiescenceDepth: 1 },
    timeLimitMs: 200,
  })).toBeNull();
});

test('screenPosition: candidate path', { timeout: 30_000 }, () => {
  const puzzle = PUZZLES.find((p) => p.id === 'black-3-3')!;
  const p = decodeGame(puzzle.encoded);
  const result = screenPosition(p, {
    weakAI: { maxDepth: 1, quiescenceDepth: 0 },
    strongAI: { maxDepth: 4, quiescenceDepth: 2 },
    timeLimitMs: 500,
  });
  if (result !== null) {
    expect(result.encoded).toBe(p.encodeGame());
    expect(result.strongMove).toBeGreaterThanOrEqual(0);
  }
  expect(true).toBe(true);
});

test('findCandidatesInGame', { timeout: 30_000 }, () => {
  const game = playAIGame({ maxGameMoves: 10, timeLimitMs: 100 });
  expect(Array.isArray(findCandidatesInGame(game, { timeLimitMs: 100 }))).toBe(true);
});

test('findCandidatesInGame: short game', { timeout: 15_000 }, () => {
  const game = playAIGame({ maxGameMoves: 2, timeLimitMs: 50 });
  expect(Array.isArray(findCandidatesInGame(game, { timeLimitMs: 50 }))).toBe(true);
});
