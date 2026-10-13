import { expect, test } from 'vitest';
import { BLACK, GogoPosition, computeZobristHashes } from '../../src/engine';

test.each([false, true])('an adjacent empty point establishes legality without scanning the friendly group (%s)', connected => {
  const game = GogoPosition.fromAscii([
    '.........', '.........', '.........', '.........', connected ? '...X.....' : '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const encoded = game.encodeGame(), hash = game.hash;
  const scan = game.scanGroup.bind(game);
  let scans = 0;
  game.scanGroup = (...args) => { scans++; return scan(...args); };
  expect(game.playXY(4, 4)).toBe(true);
  expect(scans).toBe(0);
  expect(game.koPoint).toBe(-1);
  expect(game.hash).toBe(computeZobristHashes(game));
  expect(game.undo()).toBe(true);
  expect(game.encodeGame()).toBe(encoded);
  expect(game.hash).toBe(hash);
});
