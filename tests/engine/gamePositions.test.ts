// @vitest-environment node
import { expect, test } from 'vitest';
import { GAME_POSITIONS, GogoAI, decodeGame, encodeMove } from '../../src/engine';

test.each(GAME_POSITIONS.map(position => [position.id, position] as const))(
  'AI satisfies SearchResult assertions for game position %s',
  { timeout: 60_000 },
  (_id, gamePosition) => {
    const position = decodeGame(gamePosition.encoded);
    expect(position.toMove).toBe(gamePosition.toMove);
    const ai = new GogoAI(gamePosition.searchOptions);
    const result = ai.findBestMove(position, gamePosition.timeLimitMs);
    const { allowedMoves, requireWin, ...expectedFields } = gamePosition.expectedResult;
    if (allowedMoves) {
      expect(allowedMoves, `move ${encodeMove(result.move, position.meta)} was selected but allowed are ${allowedMoves.map(move => encodeMove(move, position.meta)).join(', ')}`).toContain(result.move);
    }
    if (requireWin) {
      expect(result.forcedWin || result.heuristicWin, 'expected a forced or heuristic win').toBe(true);
    }
    expect(result).toMatchObject(expectedFields);
    expect(position.isLegal(result.move)).toBe(true);
    expect(position.encodeGame()).toBe(gamePosition.encoded);
  },
);

// Bound search work, not wall time, so the regression check survives CI noise.
test('edge attack keeps its forcing proof below the expanded setup search cost', { timeout: 60_000 }, () => {
  const fixture = GAME_POSITIONS.find(position => position.id === 'edge-attack-forced-win')!;
  const position = decodeGame(fixture.encoded);
  const result = new GogoAI({ ...fixture.searchOptions, now: () => 0 }).findBestMove(position, fixture.timeLimitMs);
  expect(result).toMatchObject(fixture.expectedResult);
  expect(result.nodes).toBeLessThan(800_000);
  expect(position.encodeGame()).toBe(fixture.encoded);
});

test('a strong losing discovery is verified across every defense before deeper discovery', { timeout: 60000 }, () => {
  const position = decodeGame('B9 e9 e8 f9');
  const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4, now: () => 0 }) as any;
  const root = ai.searchRoot.bind(ai);
  const depths: number[] = [];
  const rootPly = position.ply;
  ai.searchRoot = (...args: any[]) => { if (args[0].ply === rootPly) depths.push(args[1]); return root(...args); };
  const result = ai.findBestMove(position, 60000);
  expect(result.forcedLoss).toBe(true);
  expect(result.heuristicLoss).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(Math.max(...depths)).toBeLessThan(14);
  expect(position.encodeGame()).toBe('B9 e9 e8 f9');
});
