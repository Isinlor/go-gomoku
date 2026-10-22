import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('timed ordering and evaluation agree on quiet space choices (%s)', player => {
  const rows = [...Array(8).fill('.........'), '........' + (player === BLACK ? 'O' : 'X')];
  const position = GogoPosition.fromAscii(rows, player);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  const center = 40, edge = 4;
  expect(ai.scoreUnpreparedMove(position, center, -1)).toBeGreaterThan(ai.scoreUnpreparedMove(position, edge, -1));
  ai.configureEvaluation(position, 5);
  const evaluateMove = (move: number) => {
    expect(position.play(move)).toBe(true);
    const score = -ai.evaluate(position);
    position.undo();
    return score;
  };
  expect(evaluateMove(edge)).toBeGreaterThan(evaluateMove(center));
  expect(ai.scoreUnpreparedMove(position, edge, -1)).toBeGreaterThan(ai.scoreUnpreparedMove(position, center, -1));
});

test('prepared timed move ordering reuses incremental window scores', () => {
  const position = GogoPosition.fromAscii([...Array(8).fill('.........'), '........O'], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 5);
  ai.beginPatternPass(position);
  const expected = ai.scorePreparedMove(position, 4, -1);
  const windows = position.meta.windowsByPoint;
  let reads = 0;
  Object.defineProperty(position.meta, 'windowsByPoint', { value: new Proxy(windows, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, target);
    },
  }) });
  try {
    expect(ai.scorePreparedMove(position, 4, -1)).toBe(expected);
    expect(reads).toBe(0);
  } finally { Object.defineProperty(position.meta, 'windowsByPoint', { value: windows }); }
});

test.each([BLACK, WHITE])('coincident winning windows retain their full ordering score (%s)', player => {
  const stone = player === BLACK ? 'X' : 'O';
  const rows = Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) =>
    (x !== 4 || y !== 4) && (x === 4 || y === 4 || x === y || x + y === 8) ? stone : '.').join(''));
  const position = GogoPosition.fromAscii(rows, player);
  expect(position.winner).toBe(0);
  const ai = new GogoAI({ maxDepth: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 5);
  expect(ai.scoreUnpreparedMove(position, 40, -1)).toBeGreaterThan(2 ** 31);
  expect(ai.findBestMove(position, 5)).toMatchObject({ move: 40, forcedWin: true });
});

test('switching evaluation policies rebuilds the prepared ordering scores', () => {
  const position = GogoPosition.fromAscii([...Array(8).fill('.........'), '........O'], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const normal = ai.scoreUnpreparedMove(position, 4, -1);
  ai.configureEvaluation(position, 5);
  const timed = ai.scoreUnpreparedMove(position, 4, -1);
  expect(timed).not.toBe(normal);
  for (const budget of [0, 5, 0, 100]) {
    ai.configureEvaluation(position, budget);
    expect(ai.scoreUnpreparedMove(position, 4, -1)).toBe(budget === 0 ? normal : timed);
  }
});

test.each([BLACK, WHITE])('calibrated priorities preserve tactical eligibility (%s)', player => {
  const opponent = player === BLACK ? 'O' : 'X';
  const position = GogoPosition.fromAscii(['.' + opponent.repeat(3) + '.....', ...Array(8).fill('.........')], player);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 5);
  expect(ai.scoreUnpreparedTacticalMove(position, 0, -1)).toBe(ai.scoreUnpreparedMove(position, 0, -1));
  expect(ai.scoreUnpreparedTacticalMove(position, 80, -1)).toBe(-Infinity);
});
