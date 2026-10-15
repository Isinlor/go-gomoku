import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('full-window discovery skips a null probe that the static position cannot support', () => {
  const position = GogoPosition.fromAscii(['XX.......', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0, maxPly: 3, quiescenceDepth: 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const search = ai.search.bind(ai);
  let rootNullProbes = 0;
  ai.search = (...args: any[]) => {
    if (args[4] === 1 && args[5] === false) rootNullProbes++;
    return search(...args);
  };
  expect(Number.isFinite(ai.search(position, 3, -1_000_000_000, 1_000_000_000, 0))).toBe(true);
  expect(rootNullProbes).toBe(0);
  expect(position.ply).toBe(0);
});
