import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test.each([
  ['B9 a7 i8', 6, false],
  ['B9 a7 i8 b6', 5, false],
  ['B9 a7 i8 b6', 6, true],
] as const)('selective discovery respects opening geometry and horizon (%s, depth %s)', (encoded, depth, selective) => {
  const position = decodeGame(encoded);
  const ai = new GogoAI({ now: () => 0, maxPly: 2, quiescenceDepth: 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.searchRoot(position, depth, -1).depth).toBe(depth);
  expect(ai.selectiveSearch).toBe(selective);
  expect(position.encodeGame()).toBe(encoded);
});
