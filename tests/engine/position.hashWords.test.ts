import { expect, test } from 'vitest';
import { GogoPosition, HASH_LOW_WORD, computeZobristHashes } from '../../src/engine';

test('the public 64-bit hash and its two machine words share storage', () => {
  const position = new GogoPosition(9);
  const hash = 0xfedcba9876543210n;
  position.hash = hash;
  expect(position.hashWords).toBeInstanceOf(Uint32Array);
  expect(position.hashWords.byteLength).toBe(8);
  expect(new BigUint64Array(position.hashWords.buffer)[0]).toBe(hash);
  expect(position.hashWords[HASH_LOW_WORD]).toBe(0x76543210);
  position.hashWords[HASH_LOW_WORD] ^= 1;
  expect(position.hash).toBe(hash ^ 1n);
});

test.each([9, 11, 13] as const)('word hashes stay exact through capture, undo, and history growth on %s', size => {
  const position = new GogoPosition(size, { historyCapacity: 1 });
  expect(new BigUint64Array(position.meta.zobristTurn32.buffer)[0]).toBe(position.meta.zobristBlackToMove64);
  const check = () => {
    expect(position.hash).toBe(computeZobristHashes(position));
    expect(new BigUint64Array(position.hashWords.buffer)[0]).toBe(position.hash);
  };
  check();
  for (const move of [1, 0, size]) {
    expect(position.play(move)).toBe(true);
    check();
  }
  expect(position.lastCapturedCount).toBe(1);
  while (position.undo()) check();
});
