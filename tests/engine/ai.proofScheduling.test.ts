import { expect, test } from 'vitest';
import { GogoAI, PUZZLES, decodeGame, decodeMove } from '../../src/engine';

test('a second discovery iteration avoids proving an unstable first choice', { timeout: 1000 }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-atari-escape')!;
  const result = new GogoAI({ maxDepth: 10, now: () => 0 }).findBestMove(decodeGame(puzzle.encoded), 20000);
  expect(result.move).toBe(decodeMove(puzzle.solution, 13));
  expect(result.forcedWin).toBe(true);
  expect(result.nodes).toBeLessThan(15000);
});

test('a sustained disadvantage can trigger a deeper independent loss proof', { timeout: 3000 }, () => {
  const position = decodeGame('B9 e9 e8 f9');
  const result = new GogoAI({ maxDepth: 30, now: () => 0 }).findBestMove(position, 59000);
  expect(result.forcedLoss).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(result.nodes).toBeLessThan(200000);
  expect(position.encodeGame()).toBe('B9 e9 e8 f9');
});
