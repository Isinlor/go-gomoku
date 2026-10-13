import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function analyze(rows: string[], alpha = -Infinity, beta = Infinity, depth = 2) {
  const position = GogoPosition.fromAscii(rows, BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const encoded = position.encodeGame();
  const score = ai.quiescence(position, alpha, beta, 0, depth);
  expect(position.encodeGame()).toBe(encoded);
  return { score, ai, position };
}

const empty = '.........';

test('quiescence cannot stand pat against an unblockable opponent four, even above beta', () => {
  const rows = [empty, empty, empty, empty, '.OOOO....', empty, empty, empty, empty];
  expect(analyze(rows).score).toBe(-1_000_000_000 + 2);
  expect(analyze(rows, -Infinity, -2_000_000).score).toBe(-1_000_000_000 + 2);
});

test('quiescence searches the compulsory block instead of keeping the static score', () => {
  const rows = [empty, empty, empty, empty, 'XOOOO....', empty, empty, empty, empty];
  const { score, ai, position } = analyze(rows);
  expect(position.playXY(5, 4)).toBe(true);
  const expected = -ai.quiescence(position, -Infinity, Infinity, 1, 1);
  expect(score).toBe(expected);
});

test('an immediate own win takes precedence over the opposing threat and stand-pat cutoff', () => {
  const rows = ['XXXX.....', empty, empty, empty, '.OOOO....', empty, empty, empty, empty];
  expect(analyze(rows).score).toBe(1_000_000_000 - 1);
  expect(analyze(rows, -Infinity, -2_000_000).score).toBe(1_000_000_000 - 1);
});
