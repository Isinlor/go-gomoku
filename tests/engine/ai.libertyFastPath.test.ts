import { expect, test } from 'vitest';
import { GogoPosition, computeZobristHashes } from '../../src/engine/gogomoku';

test('moves with direct liberties avoid scanning safe groups and preserve make/undo', () => {
  const position = GogoPosition.fromAscii(['.........', '.........', '.........', '....O....', '....X....', ...Array(4).fill('.........')]);
  const before = position.toAscii();
  const hash = position.hash;
  const scan = position.scanGroup.bind(position);
  let scans = 0;
  position.scanGroup = (...args) => { scans++; return scan(...args); };
  expect(position.playXY(5, 3)).toBe(true);
  expect(scans).toBe(0);
  expect(position.hash).toBe(computeZobristHashes(position));
  expect(position.undo()).toBe(true);
  expect(position.toAscii()).toEqual(before);
  expect(position.hash).toBe(hash);
});

test('an unchanged ko point needs no ko hash table reads', () => {
  const position = new GogoPosition(9);
  const original = position.meta.zobristKo64;
  let reads = 0;
  const meta = Object.create(position.meta);
  meta.zobristKo64 = new Proxy(original, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  } });
  Object.defineProperty(position, 'meta', { value: meta });
  expect(position.playXY(4, 4)).toBe(true);
  expect(reads).toBe(0);
  expect(position.hash).toBe(computeZobristHashes(position));
});
