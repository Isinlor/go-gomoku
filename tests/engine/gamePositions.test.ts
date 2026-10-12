// @vitest-environment node
import { expect, test } from 'vitest';
import { GAME_POSITIONS, GogoAI, decodeGame } from '../../src/engine';

test.each(GAME_POSITIONS.map(position => [position.id, position] as const))(
  'AI satisfies SearchResult assertions for game position %s',
  { timeout: 60_000 },
  (_id, gamePosition) => {
    const position = decodeGame(gamePosition.encoded);
    expect(position.toMove).toBe(gamePosition.toMove);
    const ai = new GogoAI(gamePosition.searchOptions);
    const result = ai.findBestMove(position, gamePosition.timeMs);
    expect(result).toMatchObject(gamePosition.expectedResult);
    expect(position.isLegal(result.move)).toBe(true);
    expect(position.encodeGame()).toBe(gamePosition.encoded);
  },
);
