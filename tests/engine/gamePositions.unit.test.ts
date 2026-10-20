import { expect, test } from 'vitest';
import { GAME_POSITIONS, PLY2_FORCED_WINS, decodeGame, encodeMove, transformPoint } from '../../src/engine';

test('ply-two winning positions require a forced or heuristic win alongside an allowed move', () => {
  for (const fixture of PLY2_FORCED_WINS) {
    expect(fixture.expectedResult).toMatchObject({ requireWin: true, allowedMoves: expect.any(Array) });
  }
});

test('game positions have unique IDs and consistent search inputs', () => {
  expect(new Set(GAME_POSITIONS.map(position => position.id)).size).toBe(GAME_POSITIONS.length);
  for (const entry of GAME_POSITIONS) {
    const position = decodeGame(entry.encoded);
    expect(position.toMove).toBe(entry.toMove);
    expect(position.winner).toBe(0);
    expect(entry.timeLimitMs).toBeGreaterThan(0);
  }
});

// A complete winning-move set must respect every symmetry fixing the position.
test('allowed winning moves include their symmetry-equivalent alternatives', () => {
  for (const fixture of GAME_POSITIONS) {
    const allowed = fixture.expectedResult.allowedMoves;
    if (!allowed) continue;
    const position = decodeGame(fixture.encoded);
    for (let symmetry = 0; symmetry < 8; symmetry++) {
      const transform = (move: number) => {
        const [x, y] = transformPoint(symmetry, position.meta.xs[move], position.meta.ys[move], position.size);
        return position.index(x, y);
      };
      if (!position.board.every((cell, move) => cell === position.board[transform(move)])) continue;
      if (position.koPoint !== -1 && transform(position.koPoint) !== position.koPoint) continue;
      for (const move of allowed) {
        expect(allowed, `${fixture.id}: winning moves must include ${encodeMove(transform(move), position.meta)}`).toContain(transform(move));
      }
    }
  }
});
