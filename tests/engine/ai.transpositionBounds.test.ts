import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('a capped search retains its lower bound for a later narrower window', () => {
  const position = GogoPosition.fromAscii(['.........', '.........', '.X..O....', '.........', '....X....', '.........', '.O..X....', '.........', '.........'], BLACK);
  const ai = new GogoAI({ now: () => 0, maxPly: 2, quiescenceDepth: 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const score = ai.search(position, 2, -Infinity, Infinity, 1);
  const index = Number(position.hash & 262143n);
  expect(ai.ttFlag[index]).toBe(2);
  const nodes = ai.nodesVisited;
  expect(ai.search(position, 2, score - 1, score, 1)).toBe(score);
  expect(ai.nodesVisited - nodes).toBe(1);
  expect(position.ply).toBe(0);
});

test('a capped fail-low result has no lower-bound claim', () => {
  const position = GogoPosition.fromAscii(['..XX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxPly: 2, quiescenceDepth: 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.search(position, 2, 100000, 100001, 1)).toBeLessThan(100000);
  expect(ai.ttFlag[Number(position.hash & 262143n)]).toBe(0);
});
