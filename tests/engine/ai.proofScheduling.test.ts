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
  expect(result.nodes).toBeLessThan(160000);
  expect(position.encodeGame()).toBe('B9 e9 e8 f9');
});

test('a cheap ko candidate retries its proof before deeper discovery', () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-expert-ko')!;
  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ maxDepth: 10, now: () => 0 }) as any;
  const root = ai.searchRoot.bind(ai);
  const depths: number[] = [];
  ai.searchRoot = (...args: any[]) => { depths.push(args[1]); return root(...args); };
  const result = ai.findBestMove(position, 20_000);
  expect(result.move).toBe(decodeMove(puzzle.solution, position.size));
  expect(result.forcedWin).toBe(true);
  expect(result.nodes).toBeLessThan(1000);
  expect(Math.max(...depths)).toBe(1);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});

test('an unstable shallow choice leaves work for the previous winning setup', { tags: ['slow'] }, () => {
  const position = decodeGame('B9 a3 c1');
  const result = new GogoAI({ maxDepth: 30, now: () => 0 }).findBestMove(position, 1250);
  expect(result.move).toBe(decodeMove('a5', 9));
  expect(result.forcedWin).toBe(true);
  expect(result.nodes).toBeLessThan(32_000);
  expect(position.encodeGame()).toBe('B9 a3 c1');
});

test.each([['B9 a3 d1', 'a5', 46_000], ['B9 h1 d2', 'e1', 30_000]] as const)('a changed rediscovery candidate receives bounded work: %s', { tags: ['slow'] }, (encoded, move, limit) => {
  const position = decodeGame(encoded);
  const result = new GogoAI({ maxDepth: 30, now: () => 0 }).findBestMove(position, 1250);
  expect(result.move).toBe(decodeMove(move, 9));
  expect(result.forcedWin).toBe(true);
  expect(result.nodes).toBeLessThan(limit);
  expect(position.encodeGame()).toBe(encoded);
});

test('numeric evaluation retains a proof opportunity after broadening discovery', { tags: ['slow'] }, () => {
  const position = decodeGame('B9 a3 d1');
  const ai = new GogoAI({ maxDepth: 5, quiescenceDepth: 0, now: () => 0 }) as any;
  const prove = ai.tryEarlyWinProof.bind(ai);
  const modes: boolean[] = [];
  ai.tryEarlyWinProof = (...args: any[]) => { modes.push(ai.forcingQuiescence); return prove(...args); };
  const result = ai.findBestMove(position, 1250);
  expect(position.isLegal(result.move)).toBe(true);
  expect(modes).toEqual([true, false]);
  expect(result.nodes).toBeLessThan(20_000);
  expect(position.encodeGame()).toBe('B9 a3 d1');
});

test('a scout reserves discovery work as well as both candidate proofs', { timeout: 5000 }, () => {
  const position = decodeGame('B9 c1 e4');
  const ai = new GogoAI({ maxDepth: 30, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1250);
  ai.deadline = 1250;
  const state = { bestMove: 4, bestScore: 1690.4, completedDepth: 2, hintMove: 4 };
  expect(ai.tryClassicProofScout(position, state, 122_880, 30)).toBe(true);
  expect(state).toMatchObject({ bestMove: decodeMove('e1', 9), provenWin: true });
  expect(ai.nodesVisited).toBeLessThan(260_000);
  expect(ai.timedOut).toBe(false);
  expect(position.encodeGame()).toBe('B9 c1 e4');
});
