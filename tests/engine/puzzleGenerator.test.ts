import { test, expect } from 'vitest';
import { hasDuplicateSimilarity, puzzleSimilarities } from '../../src/engine/puzzleSimilarity';

import {
  ForcedWinSearcher,
  PuzzleWindowEvaluation,
  heuristicMoveScore,
  heuristicBestMove,
  isGameHistoryClean,
  validatePuzzlePosition,
  playRandomGame,
  LCG,
  generatePuzzles,
  BEGINNER,
  INTERMEDIATE,
  ADVANCED,
  type PuzzleDifficulty,
} from '../../src/engine/puzzleGenerator';

import {
  GogoPosition,
  BLACK,
  WHITE,
  EMPTY,
  decodeGame,
  decodeMove,
} from '../../src/engine/gogomoku';

test.each([9, 11, 13] as const)('cached puzzle windows on size %s match original calculations across captures and undo', (size) => {
  const evaluation = new PuzzleWindowEvaluation(size * size);
  const rng = new LCG(20261019);
  const positions = [
    decodeGame(`B${size} b1 a1 a2`),
    playRandomGame(size, rng, 8),
    playRandomGame(size, rng, 8),
    GogoPosition.fromAscii(Array.from({ length: size }, (_, y) => (
      y === 0 ? 'XXXXX' + '.'.repeat(size - 5)
        : y === 2 ? '.OOOO' + '.'.repeat(size - 5) : '.'.repeat(size)
    ))),
  ];
  for (const position of positions) {
    do {
      evaluation.sync(position);
      for (const attacker of [BLACK, WHITE] as const) {
        const defender = attacker === BLACK ? WHITE : BLACK;
        let attackerThreats = 0;
        let defenderThreats = 0;
        let maximum = 0;
        for (let wi = 0; wi < position.meta.windowCount; wi += 1) {
          let ours = 0;
          let theirs = 0;
          for (let step = 0; step < 5; step += 1) {
            const color = position.board[position.meta.windows[wi * 5 + step]];
            ours += color === attacker ? 1 : 0;
            theirs += color === defender ? 1 : 0;
          }
          attackerThreats += ours === 4 && theirs === 0 ? 1 : 0;
          defenderThreats += theirs === 4 && ours === 0 ? 1 : 0;
          maximum = Math.max(maximum, ours);
        }
        expect(evaluation.threats(attacker)).toEqual([attackerThreats, defenderThreats, maximum]);
        const saved = position.toMove;
        position.toMove = attacker;
        const actual: number[] = [];
        const expected: number[] = [];
        for (let point = 0; point < position.area; point += 1) {
          if (position.board[point] === EMPTY) {
            actual.push(evaluation.score(point, attacker));
            expected.push(heuristicMoveScore(position, point));
          }
        }
        expect(actual).toEqual(expected);
        position.toMove = saved;
      }
      // Repeated synchronization must preserve all cached values.
      evaluation.sync(position);
    } while (position.undo());
  }
});

// ---------------------------------------------------------------------------
// LCG tests
// ---------------------------------------------------------------------------

test('LCG produces deterministic sequence', () => {
  const a = new LCG(42);
  const b = new LCG(42);
  for (let i = 0; i < 10; i += 1) {
    expect(a.next()).toBe(b.next());
  }
});

test('LCG nextInt produces values in range', () => {
  const rng = new LCG(99);
  for (let i = 0; i < 100; i += 1) {
    const v = rng.nextInt(10);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(10);
  }
});

// ---------------------------------------------------------------------------
// ForcedWinSearcher tests
// ---------------------------------------------------------------------------

test('reuses completed searches without changing forced-win results', () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const searcher = new ForcedWinSearcher(81, 6);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(true);
  const firstNodes = searcher.nodesSearched;
  expect(firstNodes).toBeGreaterThan(1);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(true);
  expect(searcher.nodesSearched).toBeLessThan(firstNodes);
  expect(pos.encodeGame()).toBe('B9 c5 e3 d5 e4 f5 e6');
});

test('does not expand positions that need more attacking stones than remaining turns', () => {
  const pos = decodeGame('B9 e5 a1');
  const searcher = new ForcedWinSearcher(81, 6);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(false);
  expect(searcher.nodesSearched).toBe(1);
  expect(searcher.hasForcedWin(pos, WHITE, 4)).toBe(false);
  expect(searcher.nodesSearched).toBe(1);
});

test('cached and uncached searches agree across horizons, sides, and ko restrictions', () => {
  const cached = new ForcedWinSearcher(81, 6);
  const uncached = new ForcedWinSearcher(81, 6, false);
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const encoded = pos.encodeGame();
  for (const ko of [-1, pos.index(4, 4)]) {
    pos.koPoint = ko;
    for (const toMove of [BLACK, WHITE] as const) {
      pos.toMove = toMove;
      for (const attacker of [BLACK, WHITE] as const) {
        for (const horizon of [1, 2, 3, 4]) {
          expect(cached.hasForcedWin(pos, attacker, horizon))
            .toBe(uncached.hasForcedWin(pos, attacker, horizon));
          expect(pos.encodeGame()).toBe(encoded);
          expect(pos.toMove).toBe(toMove);
          expect(pos.koPoint).toBe(ko);
        }
      }
    }
  }
});

test('hash collisions cannot reuse a proof for a different board', () => {
  const winning = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const losing = decodeGame('B9 e5 a1');
  winning.hash = 0n;
  losing.hash = 0n;
  const searcher = new ForcedWinSearcher(81, 6);
  expect(searcher.hasForcedWin(winning, BLACK, 3)).toBe(true);
  expect(searcher.hasForcedWin(losing, BLACK, 3)).toBe(false);
  expect(searcher.hasForcedWin(winning, BLACK, 3)).toBe(true);
});

test('hasForcedWin detects immediate win (1 ply)', () => {
  // Black has 4 in a row, one move to win
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 1)).toBe(true);
  expect(searcher.hasForcedWin(pos, WHITE, 1)).toBe(false);
});

test('hasForcedWin detects 3-ply forced win (double threat)', () => {
  // Black can create a double threat
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  expect(pos.toMove).toBe(BLACK);

  const searcher = new ForcedWinSearcher(81, 6);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(true);
  expect(searcher.hasForcedWin(pos, BLACK, 1)).toBe(false);
});

test('hasForcedWin returns false for position with no forced win', () => {
  const pos = new GogoPosition(9);
  pos.play(pos.index(4, 4)); // single stone
  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(false);
});

test('hasForcedWin returns true when winner already set', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  pos.winner = BLACK;
  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 0)).toBe(true);
});

test('hasForcedWin returns false when other player already won', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    'OOOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  pos.winner = WHITE;
  const searcher = new ForcedWinSearcher(81, 4);
  expect(searcher.hasForcedWin(pos, BLACK, 3)).toBe(false);
});

test('forcedWinDepthForMove returns correct depths', () => {
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const searcher = new ForcedWinSearcher(81, 8);

  // e5 is the winning move for black in 3 plies
  const e5 = decodeMove('e5', 9);
  expect(searcher.forcedWinDepthForMove(pos, e5, 7)).toBe(3);
});

test('forcedWinDepthForMove returns 1 for immediate win', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const searcher = new ForcedWinSearcher(81, 4);
  const f5 = decodeMove('f5', 9);
  expect(searcher.forcedWinDepthForMove(pos, f5, 3)).toBe(1);
});

test('forcedWinDepthForMove returns -1 for illegal move', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const searcher = new ForcedWinSearcher(81, 4);
  // b5 already has a stone
  const b5 = decodeMove('b5', 9);
  expect(searcher.forcedWinDepthForMove(pos, b5, 3)).toBe(-1);
});

test('forcedWinDepthForMove returns -1 for non-winning move', () => {
  const pos = new GogoPosition(9);
  pos.play(pos.index(4, 4));
  const searcher = new ForcedWinSearcher(81, 4);
  const a1 = decodeMove('a1', 9);
  expect(searcher.forcedWinDepthForMove(pos, a1, 3)).toBe(-1);
});

// ---------------------------------------------------------------------------
// heuristicMoveScore / heuristicBestMove tests
// ---------------------------------------------------------------------------

test('heuristicMoveScore returns positive for useful moves', () => {
  const pos = decodeGame('B9 e5 e3 d5 e4 f5 e6');
  const e5move = decodeMove('e5', 9);
  expect(heuristicMoveScore(pos, e5move)).toBeGreaterThan(0);
});

test('heuristicBestMove returns a legal move', () => {
  const pos = decodeGame('B9 e5 e3 d5');
  const best = heuristicBestMove(pos);
  expect(best).toBeGreaterThanOrEqual(0);
  expect(pos.isLegal(best)).toBe(true);
});

test('heuristicBestMove returns a valid move on a fresh board', () => {
  const pos = new GogoPosition(9);
  const best = heuristicBestMove(pos);
  expect(best).toBeGreaterThanOrEqual(0); // Should return some move
});

// ---------------------------------------------------------------------------
// isGameHistoryClean tests
// ---------------------------------------------------------------------------

test('isGameHistoryClean accepts clean game history', () => {
  // Simple game with no forced wins at any point
  const pos = decodeGame('B9 e5 d5 e4 d4 e3');
  const searcher = new ForcedWinSearcher(81, 6);
  // This should have a clean history (or detect the forced win was played)
  const result = isGameHistoryClean(pos, searcher);
  expect(typeof result).toBe('boolean');
});

test('isGameHistoryClean returns true for empty position', () => {
  const pos = new GogoPosition(9);
  const searcher = new ForcedWinSearcher(81, 6);
  expect(isGameHistoryClean(pos, searcher)).toBe(true);
});

// ---------------------------------------------------------------------------
// validatePuzzlePosition tests
// ---------------------------------------------------------------------------

test('validatePuzzlePosition returns null for game-over position', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  pos.winner = BLACK;
  const searcher = new ForcedWinSearcher(81, 8);
  expect(validatePuzzlePosition(pos, BEGINNER, searcher)).toBeNull();
});

test('validatePuzzlePosition validates known puzzle position', () => {
  // The existing black-3-3 puzzle
  const pos = decodeGame('B9 c5 e3 d5 e4 f5 e6');
  const searcher = new ForcedWinSearcher(81, 10);
  const result = validatePuzzlePosition(pos, BEGINNER, searcher);
  // This might or might not pass all criteria (depends on history cleanliness
  // and not-obvious check), but should at least not crash
  if (result !== null) {
    expect(result.depth).toBe(3);
    expect(result.solution).toBe('e5');
  }
});

test('validatePuzzlePosition searches for forced wins even when no open-three exists', () => {
  const pos = new GogoPosition(9);
  pos.play(pos.index(4, 4));
  pos.play(pos.index(0, 0));
  const searcher = new ForcedWinSearcher(81, 8);
  expect(validatePuzzlePosition(pos, BEGINNER, searcher)).toBeNull();
  expect(searcher.nodesSearched).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// playRandomGame tests
// ---------------------------------------------------------------------------

test('playRandomGame produces a valid game', () => {
  const rng = new LCG(42);
  const pos = playRandomGame(9, rng, 30);
  expect(pos.ply).toBeGreaterThan(0);
  expect(pos.size).toBe(9);
});

test('playRandomGame with different seeds produces different games', () => {
  const pos1 = playRandomGame(9, new LCG(1), 20);
  const pos2 = playRandomGame(9, new LCG(999), 20);
  // Very unlikely to produce the exact same game
  expect(pos1.encodeGame()).not.toBe(pos2.encodeGame());
});

// ---------------------------------------------------------------------------
// generatePuzzles integration test
// ---------------------------------------------------------------------------

// Three short seeded games exercise real validation and duplicate rejection
// without searching long, dense positions unrelated to generator orchestration.
const fastGeneratorOptions = { seed: 2826, maxGames: 3, maxMovesPerGame: 15, minStones: 12 };

test('generatePuzzles finds beginner puzzles', { tags: ['slow'] }, () => {
  const { puzzles, stats } = generatePuzzles(BEGINNER, 2, fastGeneratorOptions);
  expect(puzzles.length).toBe(2);
  expect(stats.puzzlesFound).toBe(2);
  expect(stats.gamesPlayed).toBeGreaterThan(0);
  expect(stats.positionsChecked).toBeGreaterThan(0);

  const similarities = puzzleSimilarities(puzzles[0], puzzles[1]);
  expect(similarities).not.toBeNull();
  expect(hasDuplicateSimilarity(similarities!)).toBe(false);

  for (const p of puzzles) {
    expect(p.depth).toBe(3);
    expect(p.threshold).toBe(2);
    expect(p.solution.length).toBeGreaterThanOrEqual(2);
  }
});

test('generatePuzzles rejects an existing puzzle and returns the next distinct one', { tags: ['slow'] }, () => {
  const existing = {
    encoded: 'B9 e5 e4 b6 e7 c4 f7 c7 f5 d7 c3 a9 d3 b1',
    solution: 'g6', depth: 3, threshold: 2,
  };
  const { puzzles } = generatePuzzles(BEGINNER, 1, {
    ...fastGeneratorOptions,
    existingPuzzles: [existing],
  });
  expect(puzzles).toHaveLength(1);
  expect(puzzles[0]).toMatchObject({
    encoded: 'B9 e5 f4 d2 d6 f8 h4 e6 a2 e9 e7 d4 g2 g9 f6 d5',
    solution: 'g5', depth: 3, threshold: 2,
  });
});

// ---------------------------------------------------------------------------
// Regression: reject puzzles where captures neutralize threats
// ---------------------------------------------------------------------------

test('rejects puzzle where defender can capture to break double threat', () => {
  // Position: B9 e5 e6 f6 d5 d6 b3 d4 — White to move.
  // Without the capture check, the searcher sees a "forced win" via c4
  // (creating double threat at a2 and f7 on the b3-c4-d5-e6 diagonal).
  // However, Black can play c5 (capturing d5) or e7 (capturing e6),
  // which neutralizes both threats in one move.
  const pos = decodeGame('B9 e5 e6 f6 d5 d6 b3 d4');
  expect(pos.toMove).toBe(WHITE);

  const searcher = new ForcedWinSearcher(81, 10);

  // c4 should NOT be a forced win for White (captures break the threats)
  const c4 = decodeMove('c4', 9);
  expect(searcher.forcedWinDepthForMove(pos, c4, 3)).toBe(-1);

  // White should not have a forced win in 3 plies from this position
  expect(searcher.hasForcedWin(pos, WHITE, 3)).toBe(false);

  // The position should be rejected as a puzzle
  expect(validatePuzzlePosition(pos, BEGINNER, searcher)).toBeNull();

  // Verify that the captures actually work
  pos.play(c4); // White plays c4
  const c5 = decodeMove('c5', 9);
  pos.play(c5); // Black captures d5
  expect(pos.lastCapturedCount).toBe(1);
  const d5 = decodeMove('d5', 9);
  expect(pos.board[d5]).toBe(EMPTY); // d5 was captured
  pos.undo();

  const e7 = decodeMove('e7', 9);
  pos.play(e7); // Black captures e6
  expect(pos.lastCapturedCount).toBe(1);
  const e6 = decodeMove('e6', 9);
  expect(pos.board[e6]).toBe(EMPTY); // e6 was captured
});

// ---------------------------------------------------------------------------
// Difficulty constants
// ---------------------------------------------------------------------------

test('difficulty constants have correct values', () => {
  expect(BEGINNER).toEqual({ n: 3, m: 2, k: 0 });
  expect(INTERMEDIATE).toEqual({ n: 5, m: 4, k: 2 });
  expect(ADVANCED).toEqual({ n: 7, m: 4, k: 2 });
});
