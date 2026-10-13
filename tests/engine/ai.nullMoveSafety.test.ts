import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([
  [BLACK, -Infinity, 100, false],
  [WHITE, 99, 100, false],
  [BLACK, 99, 100, true],
] as const)('null pruning requires a scout window and a favorable static score (%s, %s, %s)', (player, alpha, beta, expected) => {
  const position = GogoPosition.fromAscii([
    '.........', '.........', '.........', '..XXX....', '.........',
    '..OO.....', '.........', '.........', '.........',
  ], player);
  const ai = new GogoAI({ quiescenceDepth: 0, maxPly: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const search = ai.search.bind(ai);
  let nullCalls = 0;
  ai.search = (...args: any[]) => {
    if (args[5] === false) nullCalls++;
    return search(...args);
  };
  ai.search(position, 3, alpha, beta, 1);
  expect(nullCalls).toBe(expected ? 1 : 0);
});
