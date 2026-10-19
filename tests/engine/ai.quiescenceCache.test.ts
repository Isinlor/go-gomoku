import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test.each([5, 6])('quiescence cache capacity follows discovery depth %s without mixing positions', depth => {
  const first = decodeGame('B9 b1 g5');
  const second = decodeGame('B9 d1 c1');
  expect(first.hash & 4095n).toBe(second.hash & 4095n);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(first.area);
  ai.deadline = Infinity;
  ai.selectiveSearch = depth >= 6;
  const evaluate = ai.evaluate.bind(ai);
  let evaluations = 0;
  ai.evaluate = (...args: any[]) => { evaluations++; return evaluate(...args); };
  const score = ai.quiescence(first, -Infinity, Infinity, 0, 0);
  ai.quiescence(second, -Infinity, Infinity, 0, 0);
  expect(ai.quiescence(first, -Infinity, Infinity, 0, 0)).toBe(score);
  expect(evaluations).toBe(depth < 6 ? 3 : 2);
  expect(first.encodeGame()).toBe('B9 b1 g5');
  expect(second.encodeGame()).toBe('B9 d1 c1');
});
