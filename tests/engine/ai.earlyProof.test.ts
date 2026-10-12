import { expect, test } from 'vitest';
import { GogoAI, GogoPosition, PUZZLES, decodeGame, decodeMove } from '../../src/engine';

// A five-ply win still requires independent proof beyond depth-three discovery.
test('a promising shallow move is independently proved without finishing heuristic discovery', { tags: ['slow'] }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'black-5-3')!;
  const position = decodeGame(puzzle.encoded);
  const before = position.encodeGame();
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 0, now: () => 0 }) as any;
  const searchRoot = ai.searchRoot.bind(ai);
  const discoveryDepths: number[] = [];
  ai.searchRoot = (...args: any[]) => {
    discoveryDepths.push(args[1]);
    return searchRoot(...args);
  };
  const result = ai.findBestMove(position, 20000);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(result.forcedWin).toBe(true);
  expect(result.heuristicWin).toBe(false);
  expect(discoveryDepths).toEqual([1, 2, 3]);
  expect(result.depth).toBe(5);
  expect(result.score).toBe(1_000_000_000 - 5);
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

test('discovery continues when the early proof depth limit cannot establish the win', { tags: ['slow'] }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'black-5-3')!;
  const position = decodeGame(puzzle.encoded);
  const before = position.encodeGame();
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 0, now: () => 0 }) as any;
  const earlyProof = ai.tryEarlyProof.bind(ai);
  const proofs: boolean[] = [];
  ai.tryEarlyProof = (...args: any[]) => {
    const proved = earlyProof(...args);
    proofs.push(proved);
    return proved;
  };
  const result = ai.findBestMove(position, 20000);
  expect(proofs).toEqual([false]);
  expect(result.depth).toBe(4);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(result.score).toBeCloseTo(499261.9, 8);
  expect(result.forcedWin).toBe(false);
  expect(result.timedOut).toBe(false);
  expect(position.encodeGame()).toBe(before);
});
