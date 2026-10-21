import { expect, test } from 'vitest';
import { WHITE, GogoAI, GogoPosition } from '../../src/engine';

test('exact loss proofs retain tactical ordering independently of the playing evaluation', () => {
  const orders: number[][] = [];
  for (const timed of [false, true]) {
    const position = GogoPosition.fromAscii(['.XXXX....', ...Array(8).fill('.........')], WHITE);
    const ai = new GogoAI({ now: () => 0 }) as any;
    ai.ensureBuffers(position.area);
    if (timed) ai.configureEvaluation(position, 5);
    ai.deadline = Infinity;
    const hash = position.hash;
    const generate = ai.generateAllBoardMoves.bind(ai);
    ai.generateAllBoardMoves = (...args: any[]) => {
      const count = generate(...args);
      if (args[0].hash === hash && orders.length === Number(timed)) orders.push(Array.from(args[1].slice(0, count)));
      return count;
    };
    const before = ai.scoreUnpreparedMove(position, 40, -1);
    expect(ai.proofSearchRoot(position, 3, -1)).toBe(-999_999_997);
    expect(ai.scoreUnpreparedMove(position, 40, -1)).toBe(before);
    expect(position.ply).toBe(0);
  }
  expect(orders[1]).toEqual(orders[0]);
});
