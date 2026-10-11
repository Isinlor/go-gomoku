import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition, WHITE } from '../../src/engine';

test('cached local stone scores match full evaluation through captures, undo, reuse, and side changes', () => {
  const ai = new GogoAI() as any;
  const check = (position: GogoPosition) => {
    ai.ensureBuffers(position.area);
    const actual = ai.evaluate(position);
    let expected = ai.windowEvaluation;
    for (let point = 0; point < position.area; point++) {
      const cell = position.board[point];
      let local = 0;
      if (cell !== 0) {
        let liberties = 0;
        for (let offset = 0; offset < 4; offset++) {
          const neighbor = position.meta.neighbors4[point * 4 + offset];
          if (neighbor !== -1 && position.board[neighbor] === 0) liberties++;
        }
        local = position.meta.centerBias[point] * 0.9 + [-200, -80, 20, 60, 80][liberties];
        expected += cell === BLACK ? local : -local;
      }
      expect(ai.localStoneScores[point]).toBe(local);
    }
    expect(actual).toBe(position.toMove === BLACK ? expected : -expected);
  };
  for (const size of [9, 11, 13] as const) {
    const position = new GogoPosition(size);
    check(position);
    for (const [x, y] of [[1, 0], [0, 0], [0, 1], [4, 4], [3, 4], [4, 3]]) {
      expect(position.playXY(x, y)).toBe(true);
      check(position);
    }
    for (let i = 0; i < 6; i++) {
      position.undo();
      check(position);
    }
    const other = GogoPosition.fromAscii(Array.from({ length: size }, (_, y) => y === 0 ? 'O'.repeat(size) : '.'.repeat(size)), WHITE);
    check(other);
    check(position);
    position.toMove = WHITE;
    position.hash ^= position.meta.zobristBlackToMove64;
    check(position);
    check(position);
  }
});
