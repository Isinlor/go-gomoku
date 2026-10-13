import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test.each([4, 5])('selective cache flag %s is reusable for discovery but cannot cut off exact search', flag => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const index = Number(position.hash & 0x3ffffn);
  ai.ttHash[index] = position.hash;
  ai.ttScore[index] = -123456;
  ai.ttDepth[index] = 5;
  ai.ttFlag[index] = flag;
  ai.ttBestMove[index] = -1;
  expect(ai.search(position, 2, -123455, Infinity, 1)).toBe(-123456);
  expect(ai.nodesVisited).toBe(1);
  ai.proofMode = true;
  expect(ai.search(position, 2, -123455, Infinity, 1)).not.toBe(-123456);
  expect(ai.nodesVisited).toBeGreaterThan(1);
});

test('selective upper bounds do not cut off a wider discovery window', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const index = Number(position.hash & 0x3ffffn);
  ai.ttHash[index] = position.hash;
  ai.ttScore[index] = 123456;
  ai.ttDepth[index] = 5;
  ai.ttFlag[index] = 5;
  expect(ai.search(position, 2, -Infinity, Infinity, 1)).not.toBe(123456);
  expect(ai.nodesVisited).toBeGreaterThan(1);
});
