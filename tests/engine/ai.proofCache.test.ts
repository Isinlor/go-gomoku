import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('a quiet-candidate batch reuses full proof facts without changing the position or verdict', () => {
  const position = GogoPosition.fromAscii(['.XXX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.reuseProofCache = true;
  const before = position.toAscii();
  expect(ai.verifyWinningMove(position, 4, 1000, 3)).toBe(true);
  const firstNodes = ai.nodesVisited;
  expect(ai.verifyWinningMove(position, 4, 1000, 3)).toBe(true);
  expect(ai.nodesVisited).toBeLessThan(firstNodes);
  // Another candidate must not inherit the first candidate's winning verdict.
  expect(ai.verifyWinningMove(position, 0, 1000, 3)).toBe(false);
  expect(ai.forcingProofMode).toBe(false);
  expect(position.toAscii()).toEqual(before);
  expect(position.ply).toBe(0);
});

test('a candidate round cannot prove an alternative beyond its current horizon', () => {
  const position = GogoPosition.fromAscii(['.XXX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxDepth: 9 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const state = { bestMove: 0, bestScore: 0, completedDepth: 1, hintMove: 0 };
  expect(ai.tryEarlyProof(position, state, 10000, 0, 1)).toBe(false);
  expect(state.bestMove).toBe(0);
  expect(ai.tryEarlyProof(position, state, 10000, 0, 3)).toBe(true);
  expect(position.ply).toBe(0);
});

test('a real candidate portfolio deepens past shallow failures to a verified win', () => {
  const position = GogoPosition.fromAscii(['.XXX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxDepth: 13 }) as any;
  ai.ensureBuffers(position.area);
  ai.forcingQuiescence = false;
  ai.deadline = 10_000;
  ai.rootProofCount = 2;
  ai.rootProofMoves.set([0, 4]);
  const state = { bestMove: 0, bestScore: 0, completedDepth: 5, hintMove: 0 };
  expect(ai.tryRootProofPortfolio(position, state, false)).toBe(true);
  expect(state.bestMove).toBe(4);
  expect(state.completedDepth).toBe(3);
  expect(ai.reuseProofCache).toBe(false);
  expect(ai.verifyWinningMove(position, state.bestMove, 1000, state.completedDepth)).toBe(true);
  expect(position.ply).toBe(0);
});

test('broadening a proof retains refutations within the shared short horizon', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI({ now: () => 0, maxDepth: 3 }) as any;
  const defend = ai.proofDefend.bind(ai);
  const broadNodes: number[] = [];
  ai.proofDefend = (...args: any[]) => {
    const before = ai.nodesVisited;
    const result = defend(...args);
    if (!ai.forcingProofMode && args[1] === 3 && args[2] === 1) broadNodes.push(ai.nodesVisited - before);
    return result;
  };
  expect(ai.verifyWinningMove(position, 40, 1000, 3)).toBe(false);
  expect(broadNodes).toEqual([1]);
  expect(position.ply).toBe(0);
});
