import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test('inconclusive scouts retain their search tables within one root search and release them at the next', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1000);
  ai.deadline = 1000;
  const state = { bestMove: 0, bestScore: -7, completedDepth: 1, hintMove: 0 };
  const original = { ...state };
  const prototype = GogoAI.prototype as any;
  const root = prototype.searchRoot;
  const scouts: object[] = [];
  prototype.searchRoot = function (...args: any[]) {
    if (scouts.at(-1) !== this) scouts.push(this);
    return root.apply(this, args);
  };
  try {
    expect(ai.tryClassicProofScout(position, state, 100, 2)).toBe(false);
    expect(ai.tryClassicProofScout(position, state, 100, 2)).toBe(false);
    expect(scouts.length).toBe(1);
    ai.findBestMove(position, 0);
    ai.deadline = 1000;
    expect(ai.tryClassicProofScout(position, state, 100, 2)).toBe(false);
    expect(scouts.length).toBe(2);
    expect(scouts[1] === scouts[0]).toBe(false);
  } finally { prototype.searchRoot = root; }
  expect(state).toEqual(original);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test('repeated inconclusive scouts share their speculative work budget', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 5, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1000);
  ai.deadline = 1000;
  const state = { bestMove: 0, bestScore: -7, completedDepth: 1, hintMove: 0 };
  expect(ai.tryClassicProofScout(position, state, 128, 5)).toBe(false);
  const firstNodes = ai.nodesVisited;
  expect(ai.tryClassicProofScout(position, state, 128, 5)).toBe(false);
  expect(ai.nodesVisited).toBe(firstNodes);
  // More calibrated discovery earns more speculative work.
  ai.nodesVisited += 128;
  expect(ai.tryClassicProofScout(position, state, 128, 5)).toBe(false);
  expect(ai.nodesVisited).toBeGreaterThan(firstNodes + 128);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});
