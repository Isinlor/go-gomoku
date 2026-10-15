import { expect, test } from 'vitest';
import { GogoAI, GogoPosition } from '../../src/engine';

const position = new GogoPosition(9);
const state = { bestMove: 0, bestScore: 0, completedDepth: 0, hintMove: 0 };
const moves = new Int16Array(81);
const scores = new Float64Array(81);

// Wrapper contracts keep mode names and fixed flags in sync without running
// a full search for every entry point. Engine tests exercise their behavior.
const modes: [string, string, unknown[], unknown[]][] = [
  ['clearSearchHeuristicsAndTables', 'resetSearchHeuristics', [], [true]],
  ['searchDiscoveryWithProofs', 'searchDepths', [position, state], [position, 1, state, 6, true]],
  ['searchDiscoveryOnly', 'searchDepths', [position, state], [position, 1, state, 6, false]],
  ['resumeDiscoveryDepths', 'searchDepths', [position, 2, state], [position, 2, state]],
  ['searchWithoutNullMove', 'search', [position, 4, -20, 30, 2], [position, 4, -20, 30, 2, false]],
  ['searchRootChild', 'searchChild', [position, 4, -20, 30, 2, 3], [position, 4, -20, 30, 2, 3, true]],
  ['checkTimeNow', 'checkTime', [], [true]],
  ['checkTimePeriodically', 'checkTime', [], [false]],
  ['generateNearbyMoves', 'generateOrderedMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, false, 2]],
  ['generateNearbyTacticalMoves', 'generateOrderedMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, true, 2]],
  ['generateAllBoardMoves', 'generateFullBoardMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, false, 2]],
  ['generateAllBoardTacticalMoves', 'generateFullBoardMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, true, 2]],
  ['generateMarkedMoves', 'generateFullBoardMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, false, 2, true]],
  ['generateMarkedTacticalMoves', 'generateFullBoardMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, true, 2, true]],
  ['generateAttackingMoves', 'generateTacticalMoves', [position, moves, scores, 7, 2, 2], [position, moves, scores, 7, 2, true, 2]],
  ['scorePreparedMove', 'scoreMove', [position, 5, 7, 2], [position, 5, 7, false, 2, true]],
  ['scorePreparedTacticalMove', 'scoreMove', [position, 5, 7, 2], [position, 5, 7, true, 2, true]],
  ['searchWithNullMove', 'search', [position, 4, -20, 30, 2], [position, 4, -20, 30, 2, true]],
  ['searchInteriorChild', 'searchChild', [position, 4, -20, 30, 2, 3], [position, 4, -20, 30, 2, 3, false]],
  ['resetMoveOrdering', 'resetSearchHeuristics', [], [false]],
  ['generateTacticalResponses', 'generateTacticalMoves', [position, moves, scores, 7, 2], [position, moves, scores, 7, 2, false]],
  ['scoreUnpreparedMove', 'scoreMove', [position, 5, 7, 2], [position, 5, 7, false, 2, false]],
  ['scoreUnpreparedTacticalMove', 'scoreMove', [position, 5, 7, 2], [position, 5, 7, true, 2, false]],
  ['tryEarlyWinProof', 'tryEarlyProof', [position, state, 100], [position, state, 100, 0]],
  ['tryEarlyLossProof', 'tryEarlyProof', [position, state, 100, 6], [position, state, 100, 6]],
  ['markGroupTacticalMoves', 'appendGroupTacticalMoves', [position, 1], [position, 1, -1]],
  ['appendGroupCaptureResponses', 'appendGroupTacticalMoves', [position, 1, 2, 3], [position, 1, 2, 3]],
];

test.each(modes)('%s names its fixed search mode', (name, target, args, expected) => {
  const ai = new GogoAI() as any;
  let forwarded: unknown[] = [];
  ai[target] = (...args: unknown[]) => { forwarded = args; return 17; };
  expect(ai[name](...args)).toBe(17);
  expect(forwarded).toEqual(expected);
});
