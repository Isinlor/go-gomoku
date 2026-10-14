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
  expect(discoveryDepths).toEqual([1]);
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
  expect(ai.forcingProofMode).toBe(false);
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
  expect(ai.forcingProofMode).toBe(false);
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

test.each([['gen-expert-1', 50_000], ['gen-complex-1', 56_000]] as const)('complex puzzle %s retains early proof with bounded search work', { timeout: 5_000 }, (id, nodeLimit) => {
  const puzzle = PUZZLES.find(p => p.id === id)!;
  const position = decodeGame(puzzle.encoded);
  const result = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 }).findBestMove(position, 20_000);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(result.forcedWin).toBe(true);
  expect(result.heuristicWin).toBe(false);
  expect(result.nodes).toBeLessThan(nodeLimit);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test.each(['depth limit', 'timeout'])('quiet setup proof still succeeds after the forcing pass reaches its %s', { timeout: 5_000 }, (reason) => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-complex-1')!;
  const position = decodeGame(puzzle.encoded);
  let clock = 0;
  const ai = new GogoAI({ now: () => {
    if (reason === 'timeout' && ai.forcingProofMode) clock = 6_000;
    return clock;
  } }) as any;
  const generate = ai.generateTacticalMoves.bind(ai);
  const modes: boolean[] = [];
  ai.generateTacticalMoves = (...args: any[]) => {
    if (args[4] % 2 === 0) modes.push(ai.forcingProofMode);
    return generate(...args);
  };
  expect(ai.verifyWinningMove(position, decodeMove(puzzle.solution, position.size), 20_000, puzzle.depth)).toBe(true);
  expect(modes[0]).toBe(true);
  expect(modes).toContain(false);
  expect(ai.timedOut).toBe(false);
  expect(ai.deadline).toBe(20_000);
  expect(position.encodeGame()).toBe(puzzle.encoded);
  // Reusing the engine must not leave a restricted search mode active.
  expect(ai.forcingProofMode).toBe(false);
});

test('a shallow positive candidate is proved with bounded work before deeper discovery', () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-expert-sacrifice')!;
  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 }) as any;
  const root = ai.searchRoot.bind(ai);
  const depths: number[] = [];
  ai.searchRoot = (...args: any[]) => { depths.push(args[1]); return root(...args); };
  const result = ai.findBestMove(position, 20000);
  expect(result.forcedWin).toBe(true);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(depths).toEqual([1]);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test.each(['refutation', 'timeout', 'error'])('unsuccessful early loss proof restores discovery state after %s', (reason) => {
  const position = GogoPosition.fromAscii(['..XX.....', ...Array(8).fill('.........')], 2);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = reason === 'timeout' ? 0 : 1000;
  ai.history.fill(7);
  ai.killerMoves.fill(40);
  ai.proofNodeLimit = Infinity;
  const state = { bestMove: 40, bestScore: -500000, completedDepth: 3, hintMove: 40 };
  const before = position.encodeGame();
  if (reason === 'error') position.play = () => { throw new Error('broken position'); };
  if (reason === 'error') expect(() => ai.tryEarlyLossProof(position, state, 4)).toThrow('broken position');
  else expect(ai.tryEarlyLossProof(position, state, 4)).toBe(false);
  expect(state).toEqual({ bestMove: 40, bestScore: -500000, completedDepth: 3, hintMove: 40 });
  expect(ai.deadline).toBe(reason === 'timeout' ? 0 : 1000);
  expect(ai.proofNodeLimit).toBe(Infinity);
  expect(Array.from(ai.history)).toEqual(Array(position.area * 2).fill(7));
  expect(Array.from(ai.killerMoves)).toEqual(Array((ai.maxPly + 1) * 2).fill(40));
  expect(ai.lossProofMode).toBe(false);
  expect(position.encodeGame()).toBe(before);
});

test('discovery can recover from a bounded shallow proof and prove the candidate later', { timeout: 5000 }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-complex-1')!;
  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 }) as any;
  const prove = ai.tryEarlyProof.bind(ai);
  const proofs: boolean[] = [];
  ai.tryEarlyProof = (position: GogoPosition, state: any, limit?: number) => {
    const result = prove(position, state, limit === undefined ? undefined : 1);
    proofs.push(result);
    return result;
  };
  const result = ai.findBestMove(position, 20000);
  expect(proofs).toEqual([false, true]);
  expect(result.forcedWin).toBe(true);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(ai.proofNodeLimit).toBe(Infinity);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test('an early loss proof verifies all legal defenses independently of the discovery score', () => {
  const position = GogoPosition.fromAscii(['.XXXX....', ...Array(8).fill('.........')], 2);
  const ai = new GogoAI({ maxDepth: 6, now: () => 0 }) as any;
  const search = ai.searchRoot.bind(ai);
  // Hide discovery's mate score to exercise the speculative trigger. All
  // moves and the independent loss proof still use the real engine.
  ai.searchRoot = (searched: GogoPosition, ...args: any[]) => {
    const result = search(searched, ...args);
    if (searched.ply === 0) result.score = Math.max(result.score, -500000);
    return result;
  };
  const result = ai.findBestMove(position, 1000);
  expect(result).toMatchObject({ forcedLoss: true, heuristicLoss: true, depth: 6, score: -1_000_000_000 + 6 });
  expect(position.ply).toBe(0);
});

test('an unproven early loss leaves discovery available at deeper depths', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI({ maxDepth: 6, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 1000;
  const depths: number[] = [];
  // An alarming heuristic score is only a trigger, never evidence of a loss.
  ai.searchRoot = (searched: GogoPosition, depth: number) => {
    if (searched.ply === 0) depths.push(depth);
    return { move: 40, score: -500000 };
  };
  const state = { bestMove: 40, bestScore: 0, completedDepth: 0, hintMove: 40 };
  ai.searchDepths(position, 3, state, 6, true);
  expect(depths).toEqual([3, 4, 5, 6]);
  expect(state).not.toHaveProperty('provenLoss');
  expect(ai.proofNodeLimit).toBe(Infinity);
  expect(position.ply).toBe(0);
});
