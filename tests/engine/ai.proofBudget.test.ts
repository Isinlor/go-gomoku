import { expect, test } from 'vitest';
import { GogoAI, GogoPosition, PUZZLES, WHITE, decodeGame, decodeMove } from '../../src/engine';

test('a node-bounded win proof can finish after the fractional time slice while within the overall deadline', { timeout: 5000 }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-complex-1')!;
  const position = decodeGame(puzzle.encoded);
  let calls = 0;
  const ai = new GogoAI({ maxDepth: 10, now: () => ++calls <= 3 ? 0 : 300 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const move = decodeMove(puzzle.solution, position.size);
  const state = { bestMove: move, bestScore: 500000, completedDepth: 3, hintMove: move };
  expect(ai.tryEarlyProof(position, state, 100000)).toBe(true);
  expect(state).toHaveProperty('provenWin', true);
  expect(ai.deadline).toBe(1000);
  expect(ai.timedOut).toBe(false);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test.each([[1000, true], [Infinity, false]] as const)('loss proof with allowance %s uses its appropriate deadline', { tags: ['slow'] }, (nodeLimit, proven) => {
  const position = GogoPosition.fromAscii(['.XXXX....', ...Array(8).fill('.........')], WHITE);
  let calls = 0;
  const ai = new GogoAI({ now: () => ++calls <= 2 ? 0 : 300 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const state = { bestMove: 0, bestScore: -500000, completedDepth: 2, hintMove: 0 };
  const before = position.toAscii();
  expect(ai.tryEarlyLossProof(position, state, nodeLimit, 2)).toBe(proven);
  if (proven) expect(state).toHaveProperty('provenLoss', true);
  else expect(state).not.toHaveProperty('provenLoss');
  expect(ai.deadline).toBe(1000);
  expect(ai.timedOut).toBe(false);
  expect(position.toAscii()).toEqual(before);
  expect(position.ply).toBe(0);
});
