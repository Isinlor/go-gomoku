import { describe, expect, test } from 'vitest';

import { BLACK, GogoPosition, decodeGame, decodeMove } from '../../src/engine';
import {
  createPuzzleFromPosition,
  forcedWinDistance,
  hasForcedWinWithin,
  validatePuzzleCandidate,
} from '../../src/engine/puzzle-generator';

describe('forced search helpers', () => {
  test('forcedWinDistance and hasForcedWinWithin use exact terminal outcomes', () => {
    const won = GogoPosition.fromAscii([
      'XXXXX....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ], BLACK);
    expect(forcedWinDistance(won, BLACK, 1)).toBe(0);

    const almost = GogoPosition.fromAscii([
      'XXXX.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ], BLACK);
    expect(hasForcedWinWithin(almost, BLACK, 1)).toBe(true);
    expect(hasForcedWinWithin(almost, BLACK, 0)).toBe(false);
  });
});

describe('validatePuzzleCandidate', () => {
  test('rejects invalid solution move quickly while still exercising (3,2) difficulty path', () => {
    const position = decodeGame('B9 c5 e3 d5 e4 f5 e6');
    const result = validatePuzzleCandidate(position, {
      depth: 3,
      threshold: 2,
      solutionMove: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.stage).toBe('input');
    expect(result.depth).toBe(3);
    expect(result.threshold).toBe(2);
    expect(result.proofStats.heuristicLeafCount).toBe(0);
  });

  test('rejects when solution move does not force the requested depth', () => {
    const position = GogoPosition.fromAscii([
      'XXXXOXXXX',
      'XXOXXXXOX',
      'OXXXXOXXX',
      'XXXOXXXXO',
      'XOXX.XOXX',
      'XXXXOXXXX',
      'XXOXXXXOX',
      'OXXXXOXXX',
      'XXXOXXXXO',
    ], BLACK);
    const result = validatePuzzleCandidate(position, {
      depth: 3,
      threshold: 2,
      solutionMove: decodeMove('e5', 9),
      checkNotObvious: false,
      checkRealisticHistory: false,
      proofHorizon: 4,
    });
    expect(result.valid).toBe(false);
    expect(result.stage).toBe('unique-solution');
  });

});

describe('createPuzzleFromPosition', () => {
  test('builds puzzle data with encoded game record and metadata', () => {
    const position = decodeGame('B9 c5 e3 d5 e4 f5 e6');
    const puzzle = createPuzzleFromPosition(position, {
      id: 'generated-3-2-example',
      solutionMove: decodeMove('e5', 9),
      depth: 3,
      threshold: 2,
    });
    expect(puzzle.id).toBe('generated-3-2-example');
    expect(puzzle.encoded).toBe('B9 c5 e3 d5 e4 f5 e6');
    expect(puzzle.solution).toBe('e5');
    expect(puzzle.depth).toBe(3);
    expect(puzzle.threshold).toBe(2);
  });
});
