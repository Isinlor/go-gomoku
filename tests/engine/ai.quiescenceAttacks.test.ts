import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('quiet quiescence does not spend nodes on speculative blocks of an opponent three', () => {
  const position = GogoPosition.fromAscii(['.........', '.........', '.........', '.OOO.....', ...Array(5).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const expected = ai.evaluate(position);
  expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(expected);
  expect(ai.nodesVisited).toBe(1);
  expect(position.ply).toBe(0);
});

test('long-budget searches retain defensive quiescence setups for proof discovery', () => {
  const position = GogoPosition.fromAscii(['.........', '.........', '.........', '.OOO.....', ...Array(5).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxDepth: 1 }) as any;
  ai.findBestMove(position, 100);
  expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(-133);
  expect(position.ply).toBe(0);
});

test('reusing an AI across short and long budgets invalidates scores from the other quiescence policy', () => {
  const position = GogoPosition.fromAscii(['.........', '.........', '.........', '.OOO.....', ...Array(5).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxDepth: 1 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const shortScore = ai.quiescence(position, -1e9, 1e9, 0, 4);
  for (const [budget, expected] of [[100, -133], [5, shortScore]]) {
    ai.findBestMove(position, budget);
    expect(ai.quiescence(position, -1e9, 1e9, 0, 4)).toBe(expected);
    expect(position.ply).toBe(0);
  }
});
