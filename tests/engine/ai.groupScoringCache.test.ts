import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test('tactical group traversal primes the scoring cache without scanning groups twice', () => {
  const position = GogoPosition.fromAscii(['.OO......', '.XX......', '.........', ...Array(6).fill('.........')]);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  let scans = 0;
  const scan = position.scanGroup.bind(position);
  position.scanGroup = (...args) => { scans++; return scan(...args); };
  ai.markGroupTacticalMoves(position, BLACK);
  ai.markGroupTacticalMoves(position, WHITE);
  const traversals = scans;
  for (const point of [1, 2, 10, 11]) {
    ai.primeScoredGroupInfo(position, point, position.board[point]);
    expect(ai.scoredGroupSizes[point]).toBe(2);
    expect(ai.scoredGroupLiberties[point]).toBe(point < 9 ? 2 : 4);
  }
  expect(scans).toBe(traversals);
  expect(traversals).toBe(2);
  expect(position.play(0)).toBe(true);
  ai.primeScoredGroupInfo(position, 1, WHITE);
  expect(ai.scoredGroupLiberties[1]).toBe(1);
  expect(position.undo()).toBe(true);
  ai.primeScoredGroupInfo(position, 1, WHITE);
  expect(ai.scoredGroupLiberties[1]).toBe(2);
});
