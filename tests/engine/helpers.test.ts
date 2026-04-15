import { describe, expect, test } from 'vitest';

import { BLACK, EMPTY, WHITE } from '../../src/engine';
import { position, rawPosition } from './helpers';

describe('engine test helpers', () => {
  test('position builds a board and forwards options', () => {
    const game = position([
      'X........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ], WHITE, { historyCapacity: 2, captureCapacity: 3 });
    const internals = game as unknown as {
      historyMoves: Int16Array;
      capturePositions: Int16Array;
    };

    expect(game.toMove).toBe(WHITE);
    expect(game.at(0, 0)).toBe(BLACK);
    expect(internals.historyMoves.length).toBe(2);
    expect(internals.capturePositions.length).toBe(3);
  });

  test('rawPosition clears the winner without changing the board', () => {
    const game = rawPosition([
      'XXXXX....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);

    expect(game.winner).toBe(EMPTY);
    expect(game.at(0, 0)).toBe(BLACK);
  });
});
