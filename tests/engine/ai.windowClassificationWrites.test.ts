import { expect, test } from 'vitest';
import { GogoAI, GogoPosition } from '../../src/engine';

test('a first isolated stone updates counts without rewriting unchanged tactical classifications', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.beginWindowPass(position);
  let writes = 0;
  for (const field of ['activeWindows', 'winningWindows']) {
    const bits = ai[field];
    ai[field] = new Proxy(bits, {
      get(target, key) { return Reflect.get(target, key, target); },
      set(target, key, value) { writes++; return Reflect.set(target, key, value, target); },
    });
  }
  expect(position.play(40)).toBe(true);
  ai.beginWindowPass(position);
  expect(ai.windowCounts.some((count: number) => count > 0)).toBe(true);
  expect(writes).toBe(0);
});
