import { describe, expect, test } from 'vitest';

import { GogoPosition, decodeGame } from '../../src/engine/gogomoku';
import {
  computePositionSymmetryKey,
  streamUniqueBoards,
} from '../../src/engine/boardStream';

const UNIQUE_PLY3_TRANSLATION_AND_COLOR_COUNT = 2979;

describe('computePositionSymmetryKey', () => {
  test('always folds rotation and reflection symmetries', () => {
    const cornerA = decodeGame('B9 a1');
    const cornerB = decodeGame('B9 i1');

    expect(
      computePositionSymmetryKey(cornerA, {
        includeTranslationSymmetry: false,
        includeColorSymmetry: false,
      }),
    ).toBe(
      computePositionSymmetryKey(cornerB, {
        includeTranslationSymmetry: false,
        includeColorSymmetry: false,
      }),
    );
  });

  test('returns an empty key for an empty board', () => {
    expect(
      computePositionSymmetryKey(new GogoPosition(9), {
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
      }),
    ).toBe('');
  });

  test('sorts stones correctly when coordinates share the same file', () => {
    const a = decodeGame('B9 e5 e6');
    const b = decodeGame('B9 e4 e5');

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    ).toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    );
  });

  test('translation symmetry is optional', () => {
    const a = decodeGame('B9 a1');
    const b = decodeGame('B9 b2');

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: false,
        includeColorSymmetry: false,
      }),
    ).not.toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: false,
        includeColorSymmetry: false,
      }),
    );

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    ).toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    );
  });

  test('color symmetry is optional', () => {
    const a = GogoPosition.fromAscii([
      '.........',
      '.........',
      '.........',
      '.........',
      '....XO...',
      '....X....',
      '.........',
      '.........',
      '.........',
    ]);
    const b = GogoPosition.fromAscii([
      '.........',
      '.........',
      '.........',
      '.........',
      '....OX...',
      '....O....',
      '.........',
      '.........',
      '.........',
    ]);

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    ).not.toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    );

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
      }),
    ).toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
      }),
    );
  });

  test('handles larger stone counts that use the typed-array sort path', () => {
    const a = GogoPosition.fromAscii([
      'XXOOXXOO.',
      'OOXXOOXX.',
      'XXOOXXOO.',
      'OOXXOOXX.',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
    const b = GogoPosition.fromAscii([
      '.OOXXOOXX',
      '.XXOOXXOO',
      '.OOXXOOXX',
      '.XXOOXXOO',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
      }),
    ).toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
      }),
    );
  });

  test('handles 16+ stones with unsorted coordinates on translation symmetry', () => {
    const a = GogoPosition.fromAscii([
      'XXXXXXXX.',
      'OOOOOOOO.',
      'XXXXXXXX.',
      'OOOOOOOO.',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
    const b = GogoPosition.fromAscii([
      '.OOOOOOOO',
      '.XXXXXXXX',
      '.OOOOOOOO',
      '.XXXXXXXX',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);

    expect(
      computePositionSymmetryKey(a, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    ).toBe(
      computePositionSymmetryKey(b, {
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
      }),
    );
  });

  test('correctly sorts many unordered stones for symmetry key computation', () => {
    const pos = GogoPosition.fromAscii([
      'X.X.X.X..',
      '.X.X.X.X.',
      'X.X.X.X..',
      '.X.X.X.X.',
      'X.X.X.X..',
      '.X.X.X.X.',
      '.........',
      '.........',
      '.........',
    ]);

    const key = computePositionSymmetryKey(pos, {
      includeTranslationSymmetry: true,
      includeColorSymmetry: false,
    });

    expect(key).toBeTruthy();
    expect(typeof key).toBe('string');
  });
});

describe('streamUniqueBoards', () => {
  test('emits a centered representative when translation symmetry is enabled', () => {
    const boards: string[] = [];

    const stats = streamUniqueBoards(
      {
        ply: 1,
        boardSize: 9,
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
        seed: 7,
      },
      (board) => {
        boards.push(board);
      },
    );

    expect(boards).toEqual(['B9 e5']);
    expect(stats.emitted).toBe(1);
    expect(stats.truncatedByAmount).toBe(false);
    expect(stats.truncatedByTime).toBe(false);
  });

  test('keeps distinct absolute placements when translation symmetry is disabled', () => {
    const boards: string[] = [];

    const stats = streamUniqueBoards(
      {
        ply: 1,
        boardSize: 9,
        includeTranslationSymmetry: false,
        includeColorSymmetry: false,
        seed: 7,
      },
      (board) => {
        boards.push(board);
      },
    );

    expect(boards).toHaveLength(15);
    expect(stats.emitted).toBe(15);
  });

  test('stops once the requested amount limit is reached', () => {
    const boards: string[] = [];

    const stats = streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
        maxBoards: 3,
        seed: 11,
      },
      (board) => {
        boards.push(board);
      },
    );

    expect(boards).toHaveLength(3);
    expect(stats.emitted).toBe(3);
    expect(stats.truncatedByAmount).toBe(true);
    expect(stats.truncatedByTime).toBe(false);
  });

  test('prunes equivalent prefixes while searching', () => {
    const stats = streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
        seed: 1,
      },
      () => {},
    );

    expect(stats.prunedPrefixes).toBeGreaterThan(0);
  });

  test('returns the known unique ply-three count with translation and color symmetry', { timeout: 10_000 }, () => {
    const stats = streamUniqueBoards(
      {
        ply: 3,
        boardSize: 9,
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
        seed: 1,
      },
      () => {},
    );

    expect(stats.prunedPrefixes).toBeGreaterThan(0);
    expect(stats.emitted).toBe(UNIQUE_PLY3_TRANSLATION_AND_COLOR_COUNT);
    expect(stats.exploredNodes).toBeGreaterThan(stats.emitted);
  });

  test('stops once the time limit is reached', () => {
    const boards: string[] = [];
    let nowCall = 0;
    const times = [0, 0, 2, 2, 2];

    const stats = streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: true,
        includeColorSymmetry: true,
        timeLimitMs: 1,
        now: () => times[nowCall++] ?? 2,
        seed: 3,
      },
      (board) => {
        boards.push(board);
      },
    );

    expect(stats.truncatedByTime).toBe(true);
    expect(stats.emitted).toBe(boards.length);
    expect(boards.length).toBeLessThan(44);
  });

  test('supports a zero seed and a zero amount limit', () => {
    const boards: string[] = [];
    const stats = streamUniqueBoards(
      {
        ply: 1,
        boardSize: 9,
        includeTranslationSymmetry: true,
        includeColorSymmetry: false,
        maxBoards: 0,
        seed: 0,
      },
      (board) => {
        boards.push(board);
      },
    );

    expect(boards).toEqual([]);
    expect(stats.exploredNodes).toBe(0);
    expect(stats.truncatedByAmount).toBe(true);
  });

  test('uses default size and seed and can emit the empty board at ply zero', () => {
    const boards: string[] = [];

    const stats = streamUniqueBoards(
      {
        ply: 0,
        includeTranslationSymmetry: false,
        includeColorSymmetry: false,
      },
      (board) => {
        boards.push(board);
      },
    );

    expect(boards).toEqual(['B9']);
    expect(stats.emitted).toBe(1);
  });

  test('is repeatable for the same seed', () => {
    const boardsA: string[] = [];
    const boardsB: string[] = [];

    const statsA = streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: false,
        includeColorSymmetry: true,
        seed: 1,
      },
      (board) => {
        boardsA.push(board);
      },
    );

    const statsB = streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: false,
        includeColorSymmetry: true,
        seed: 1,
      },
      (board) => {
        boardsB.push(board);
      },
    );

    expect(statsA).toEqual(statsB);
    expect(boardsA).toEqual(boardsB);
    expect(boardsA).toHaveLength(statsA.emitted);
  });

  test('changes emitted representatives when the seed changes', () => {
    const boardsA: string[] = [];
    const boardsB: string[] = [];

    const stats = streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: false,
        includeColorSymmetry: true,
        seed: 1,
      },
      (board) => {
        boardsA.push(board);
      },
    );

    streamUniqueBoards(
      {
        ply: 2,
        boardSize: 9,
        includeTranslationSymmetry: false,
        includeColorSymmetry: true,
        seed: 2,
      },
      (board) => {
        boardsB.push(board);
      },
    );

    expect(stats.emitted).toBe(446);
    expect(boardsA).toHaveLength(boardsB.length);
    expect(boardsA).not.toEqual(boardsB);
  });

  test('rejects invalid stream options', () => {
    expect(() =>
      streamUniqueBoards(
        {
          ply: -1,
          boardSize: 9,
          includeTranslationSymmetry: false,
          includeColorSymmetry: false,
        },
        () => {},
      ),
    ).toThrow('Invalid ply: -1');

    expect(() =>
      streamUniqueBoards(
        {
          ply: 1,
          boardSize: 9,
          includeTranslationSymmetry: false,
          includeColorSymmetry: false,
          maxBoards: Number.NaN,
        },
        () => {},
      ),
    ).toThrow('Invalid maxBoards: NaN');

    expect(() =>
      streamUniqueBoards(
        {
          ply: 1,
          boardSize: 10 as 9,
          includeTranslationSymmetry: false,
          includeColorSymmetry: false,
        },
        () => {},
      ),
    ).toThrow('Unsupported board size: 10');
  });
});
