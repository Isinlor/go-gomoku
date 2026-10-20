import { expect, test } from 'vitest';
import { GogoAI, GogoPosition } from '../../src/engine';

test.each([9, 11, 13] as const)('direct-liberty facts survive captures, undo, reuse, and resizing (%s)', size => {
  const position = new GogoPosition(size);
  const ai = new GogoAI() as any;
  ai.ensureBuffers((size === 9 ? 11 : 9) ** 2);
  ai.ensureBuffers(position.area);
  function check(boardPosition: GogoPosition) {
    const board = boardPosition.board;
    const expected = Array.from(board, (_, point) => Array.from(
      boardPosition.meta.neighbors4.slice(point * 4, point * 4 + 4),
    ).filter(neighbor => neighbor >= 0 && board[neighbor] === 0).length);
    ai.beginWindowPass(boardPosition);
    let reads = 0;
    Object.defineProperty(boardPosition, 'board', { value: new Proxy(board, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, target);
      },
    }) });
    for (let point = 0; point < boardPosition.area; point++) {
      for (const maximum of [0, 1, 2, 3, 4]) {
        expect(ai.hasExcessDirectLiberties(point, maximum)).toBe(expected[point] > maximum);
      }
    }
    // Prepared move-ordering facts need no further board scans.
    expect(reads).toBe(0);
    Object.defineProperty(boardPosition, 'board', { value: board });
  }
  check(position);
  position.playXY(1, 0);
  position.playXY(0, 0);
  check(position);
  position.playXY(0, 1);
  expect(position.lastCapturedCount).toBe(1);
  check(position);
  position.undo();
  check(position);
  const other = GogoPosition.fromAscii(Array.from({ length: size }, (_, y) => y === 0 ? 'O'.repeat(size) : '.'.repeat(size)));
  check(other);
  check(position);
});
