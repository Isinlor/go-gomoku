import { expect, test } from 'vitest';
import { GogoAI, GogoPosition, PUZZLES, decodeGame, decodeMove } from '../../src/engine';

// Keep the real nine-ply expert proof: a shallow fixture would miss this regression.
// Five CI samples: 3.985–5.118 s. The log-normal prediction limit is 10.5 s
// at a 0.01/11 tail probability; round up for the full clock-free proof.
test('a promising shallow move is independently proved without finishing heuristic discovery', { tags: ['slow'], timeout: 15_000 }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-expert-1')!;
  const position = decodeGame(puzzle.encoded);
  const before = position.encodeGame();
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const result = ai.findBestMove(position, 20000);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(result.forcedWin).toBe(true);
  expect(result.heuristicWin).toBe(false);
  expect(result.depth).toBe(9);
  expect(result.score).toBe(1_000_000_000 - 9);
  expect(result.timedOut).toBe(false);
  expect(position.encodeGame()).toBe(before);
});

test('unsuccessful early proof restores the discovery budget, history, killers, and position', () => {
  const ai = new GogoAI({ maxDepth: 4, now: () => 0 }) as any;
  const position = new GogoPosition(9);
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  ai.history.fill(7);
  ai.killerMoves.fill(40);
  ai.nodesVisited = 12;
  const state = { bestMove: 40, bestScore: 500000, completedDepth: 3, hintMove: 40 };
  expect(ai.tryEarlyProof(position, state)).toBe(false);
  expect(state).toEqual({ bestMove: 40, bestScore: 500000, completedDepth: 3, hintMove: 40 });
  expect(ai.deadline).toBe(1000);
  expect(Array.from(ai.history)).toEqual(Array(position.area * 2).fill(7));
  expect(Array.from(ai.killerMoves)).toEqual(Array((ai.maxPly + 1) * 2).fill(40));
  expect(ai.nodesVisited).toBeGreaterThan(12);
  expect(ai.timedOut).toBe(false);
  expect(position.ply).toBe(0);
});

test('a speculative timeout leaves time for discovery and restores the position', () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-expert-1')!;
  const position = decodeGame(puzzle.encoded);
  const before = position.encodeGame();
  let clocks = 0;
  const ai = new GogoAI({ maxDepth: 10, now: () => ++clocks <= 2 ? 0 : 300 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const state = { bestMove: decodeMove(puzzle.solution, position.size), bestScore: 500000, completedDepth: 3, hintMove: -1 };
  expect(ai.tryEarlyProof(position, state)).toBe(false);
  expect(ai.deadline).toBe(1000);
  expect(ai.timedOut).toBe(false);
  expect(state).not.toHaveProperty('provenWin');
  expect(position.encodeGame()).toBe(before);
});

test('unexpected proof errors restore discovery state before propagating', () => {
  const ai = new GogoAI({ maxDepth: 4, now: () => 0 }) as any;
  const position = new GogoPosition(9);
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  ai.history.fill(7);
  position.play = () => { throw new Error('broken position'); };
  const state = { bestMove: 40, bestScore: 500000, completedDepth: 3, hintMove: 40 };
  expect(() => ai.tryEarlyProof(position, state)).toThrow('broken position');
  expect(ai.deadline).toBe(1000);
  expect(Array.from(ai.history)).toEqual(Array(position.area * 2).fill(7));
});

// Search the same expert position to depth four after its speculative proof fails.
test('discovery continues when the early proof depth limit cannot establish the win', { tags: ['slow'] }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-expert-1')!;
  const position = decodeGame(puzzle.encoded);
  const before = position.encodeGame();
  const result = new GogoAI({ maxDepth: 4, quiescenceDepth: 4, now: () => 0 }).findBestMove(position, 20000);
  expect(result.depth).toBe(4);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(result.score).toBeCloseTo(-404.5, 8);
  expect(result.forcedWin).toBe(false);
  expect(result.timedOut).toBe(false);
  expect(position.encodeGame()).toBe(before);
});
