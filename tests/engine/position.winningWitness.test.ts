import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('five detection stops after a sufficient winning witness (%s)', color => {
  const row = (color === BLACK ? 'X' : 'O').repeat(13);
  const position = GogoPosition.fromAscii([row, ...Array(12).fill('.............')], color) as any;
  const board = position.board;
  let reads = 0;
  Object.defineProperty(position, 'board', { value: new Proxy(board, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, target);
    },
  }) });
  expect(position.checkFiveFrom(6, color)).toBe(true);
  expect(reads).toBeLessThanOrEqual(4);
});
