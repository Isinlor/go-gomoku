import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function setup() {
  const position = GogoPosition.fromAscii(['.........', '.........', '.........', '.OOO.....', ...Array(5).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxDepth: 1 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  return { ai, position };
}

test('forcing discovery avoids speculative blocks of an opponent three', () => {
  const { ai, position } = setup();
  const expected = ai.evaluate(position);
  expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(expected);
  expect(ai.nodesVisited).toBe(1);
  expect(position.ply).toBe(0);
});

test('an unsuccessful win-proof probe rebuilds discovery with quiet defensive setups', { tags: ['slow'] }, () => {
  const { ai, position } = setup();
  const initial = ai.evaluate(position);
  ai.quiescence(position, -1e9, 1e9, 0, 4);
  const state = { bestMove: 0, bestScore: initial, completedDepth: 1, hintMove: 0 };
  expect(ai.tryEarlyWinProof(position, state)).toBe(false);
  expect(state.bestMove).not.toBe(0);
  expect(position.isLegal(state.bestMove)).toBe(true);
  expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(-133);
  ai.findBestMove(position, 5);
  ai.deadline = Infinity;
  // Restored forcing quiescence stands pat under the current evaluation.
  expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(ai.evaluate(position));
  expect(position.ply).toBe(0);
});

test('speculative work is bounded by discovery and an unpromising revised candidate is not re-probed', { tags: ['slow'] }, () => {
  const { ai, position } = setup();
  const result = ai.searchRoot(position, 1, -1);
  const discoveryNodes = ai.nodesVisited;
  // Exercise allocation across several promising root candidates.
  ai.rootProofCount = 4;
  const probe = ai.tryEarlyProof.bind(ai);
  const limits: number[] = [];
  ai.tryEarlyProof = (...args: any[]) => { limits.push(args[2]); return probe(...args); };
  const state = { bestMove: result.move, bestScore: result.score, completedDepth: 1, hintMove: result.move };
  ai.tryEarlyWinProof(position, state, 100_000);
  expect(limits[0]).toBe(Math.ceil(discoveryNodes / 4));
  expect(state.bestScore).toBeLessThan(0);
  expect(limits).toHaveLength(1);
  expect(position.ply).toBe(0);
});

test('forcing quiescence avoids speculative blocks across evaluation policies and AI reuse', { tags: ['slow'] }, () => {
  const { ai, position } = setup();
  for (const budget of [5, 99, 100, 1000, 5]) {
    ai.findBestMove(position, budget);
    ai.deadline = Infinity;
    const expected = ai.evaluate(position);
    const nodes = ai.nodesVisited;
    expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(expected);
    expect(ai.nodesVisited - nodes).toBe(1);
    expect(position.ply).toBe(0);
  }
});

test('an expired proof probe preserves the completed discovery candidate', { tags: ['slow'] }, () => {
  const position = GogoPosition.fromAscii(['.........', '.........', '.........', '.OOO.....', ...Array(5).fill('.........')], BLACK);
  let clock = 0;
  const ai = new GogoAI({ now: () => clock, maxDepth: 1 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const result = ai.searchRoot(position, 1, -1);
  const state = { bestMove: result.move, bestScore: result.score, completedDepth: 1, hintMove: result.move };
  const completed = { ...state };
  clock = 1000;
  expect(ai.tryEarlyWinProof(position, state, 100)).toBe(false);
  expect(ai.timedOut).toBe(true);
  expect(state).toEqual(completed);
  expect(position.ply).toBe(0);
});
