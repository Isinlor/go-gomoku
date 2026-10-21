import { expect, test } from 'vitest';
import { GogoAI, GogoPosition, PUZZLES, WHITE, decodeGame, decodeMove } from '../../src/engine';

test('a node-bounded win proof can finish after the fractional time slice while within the overall deadline', { timeout: 5000 }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-complex-1')!;
  const position = decodeGame(puzzle.encoded);
  let calls = 0;
  const ai = new GogoAI({ maxDepth: 10, now: () => ++calls <= 3 ? 0 : 300 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const move = decodeMove(puzzle.solution, position.size);
  const state = { bestMove: move, bestScore: 500000, completedDepth: 3, hintMove: move };
  expect(ai.tryEarlyProof(position, state, 100000)).toBe(true);
  expect(state).toHaveProperty('provenWin', true);
  expect(ai.deadline).toBe(1000);
  expect(ai.timedOut).toBe(false);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test.each([[1000, true], [Infinity, false]] as const)('loss proof with allowance %s uses its appropriate deadline', { tags: ['slow'] }, (nodeLimit, proven) => {
  const position = GogoPosition.fromAscii(['.XXXX....', ...Array(8).fill('.........')], WHITE);
  let calls = 0;
  const ai = new GogoAI({ now: () => ++calls <= 2 ? 0 : 300 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const state = { bestMove: 0, bestScore: -500000, completedDepth: 2, hintMove: 0 };
  const before = position.toAscii();
  expect(ai.tryEarlyLossProof(position, state, nodeLimit, 2)).toBe(proven);
  if (proven) expect(state).toHaveProperty('provenLoss', true);
  else expect(state).not.toHaveProperty('provenLoss');
  expect(ai.deadline).toBe(1000);
  expect(ai.timedOut).toBe(false);
  expect(position.toAscii()).toEqual(before);
  expect(position.ply).toBe(0);
});

test('a deep search reserves half its remaining time for discovery during shallow speculation', { tags: ['slow'] }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-atari-escape')!;
  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ maxDepth: 30, now: () => 0 }) as any;
  const prototype = GogoAI.prototype as any;
  const proof = prototype.tryEarlyProof;
  const deadlines: number[] = [];
  prototype.tryEarlyProof = function (...args: any[]) {
    deadlines.push(this.deadline);
    return proof.apply(this, args);
  };
  let result;
  try { result = ai.findBestMove(position, 20_000); }
  finally { prototype.tryEarlyProof = proof; }
  expect(result.forcedWin).toBe(true);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(deadlines.length).toBeGreaterThan(0);
  expect(deadlines[0]).toBe(20_000);
  expect(deadlines.slice(1).length).toBeGreaterThan(0);
  expect(deadlines.slice(1).every(deadline => deadline === 10_000)).toBe(true);
  expect(result.nodes).toBeLessThan(15_000);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test.each([600, 1100])('a speculative time slice restores the overall deadline at %s ms', clock => {
  const position = decodeGame('B9 e5 d5');
  const before = position.encodeGame();
  let calls = 0;
  const ai = new GogoAI({ now: () => calls++ === 0 ? 0 : clock }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const state = { bestMove: 0, bestScore: 480, completedDepth: 2, hintMove: 0 };
  expect(ai.tryEarlyWinProof(position, state, 4096, 3, true)).toBe(false);
  expect(ai.deadline).toBe(1000);
  expect(ai.timedOut).toBe(clock >= 1000);
  expect(position.encodeGame()).toBe(before);
});

test.each([0, 1])('an inconclusive loss proof preserves calibrated play with allowance %s', allowance => {
  const position = decodeGame('B9 e9 e8 f9');
  const ai = new GogoAI({ maxDepth: 30, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1000);
  ai.deadline = 1000;
  const expected = ai.evaluate(position);
  const state = { bestMove: 75, bestScore: -2328.6, completedDepth: 6, hintMove: 75 };
  const before = { ...state };
  expect(ai.tryEarlyLossProof(position, state, allowance, 13)).toBe(false);
  expect(state).toEqual(before);
  expect(ai.evaluate(position)).toBe(expected);
  expect(ai.shortEvaluation).toBe(true);
  expect(ai.deadline).toBe(1000);
  if (allowance > 0) expect(ai.nodesVisited).toBeGreaterThan(1);
  expect(position.encodeGame()).toBe('B9 e9 e8 f9');
});

test('a loss-ordering scout respects the overall deadline without changing the move', () => {
  const position = decodeGame('B9 e9 e8 f9');
  let calls = 0;
  const ai = new GogoAI({ maxDepth: 30, now: () => calls++ === 0 ? 0 : 1000 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1000);
  ai.deadline = 1000;
  const state = { bestMove: 75, bestScore: -2328.6, completedDepth: 6, hintMove: 75 };
  const before = { ...state };
  expect(ai.tryEarlyLossProof(position, state, 1000, 13)).toBe(false);
  expect(ai.timedOut).toBe(true);
  expect(state).toEqual(before);
  expect(ai.shortEvaluation).toBe(true);
  expect(ai.deadline).toBe(1000);
  expect(position.encodeGame()).toBe('B9 e9 e8 f9');
});
