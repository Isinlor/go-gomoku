import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition, decodeGame } from '../../src/engine';

test.each([BLACK, WHITE])('strategic group evaluation counts each group once for player %s', (player) => {
  const position = GogoPosition.fromAscii([
    '.O.......', 'OXO......', '.O.......', '.........', '....XXX..',
    '.........', '.........', '........O', 'XX.......',
  ], player);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const seen = new Set<number>();
  const weights = [-10000, -500, 0, 30, 60];
  let expected = 0;
  for (let point = 0; point < position.area; point++) {
    const color = position.board[point];
    if (color === 0 || seen.has(point)) continue;
    const liberties = position.scanGroup(point, color as typeof BLACK);
    const size = position.scanGroupSize;
    for (let j = 0; j < size; j++) seen.add(position.groupBuffer[j]);
    expected += weights[Math.min(liberties, 4)] * size * (color === player ? 1 : -1);
  }
  expect(ai.evaluateGroups(position)).toBe(expected);
  expect(ai.evaluateGroups(position)).toBe(expected);
  expect(position.ply).toBe(0);
});

test('changing the evaluation policy clears incompatible cached scores', { tags: ['slow'] }, () => {
  const position = decodeGame('B9 e5 d4 f5 d5');
  const ai = new GogoAI({ maxDepth: 2, now: () => 0 }) as any;
  ai.findBestMove(position, 25);
  expect(ai.strategicEvaluation).toBe(true);
  const long = ai.findBestMove(position, 1000);
  expect(ai.strategicEvaluation).toBe(false);
  const fresh = new GogoAI({ maxDepth: 2, now: () => 0 }).findBestMove(position, 1000);
  expect(long.move).toBe(fresh.move);
  expect(long.score).toBe(fresh.score);
  ai.findBestMove(position, 1000);
  expect(ai.strategicEvaluation).toBe(false);
});
