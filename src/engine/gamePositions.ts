import type { GogoAIOptions, SearchResult } from './ai';
import { BLACK, WHITE, decodeMove, type Player } from './gogomoku';

/** Search regression cases without a puzzle's unique winning move requirement. */
export interface GamePosition {
  readonly id: string;
  readonly encoded: string;
  readonly toMove: Player;
  readonly searchOptions: Readonly<Omit<GogoAIOptions, 'now'>>;
  readonly timeLimitMs: number;
  /** Deterministic result conditions; allowedMoves is expected to cover every win in the fixture's documented depth horizon. */
  readonly expectedResult: Readonly<Partial<SearchResult> & {
    allowedMoves?: readonly number[];
    /** Require forcedWin or heuristicWin in addition to the other conditions. */
    requireWin?: true;
  }>;
}

/**
 * Ply2 positions with exhaustive lists of the fastest winning moves (11 plies).
 * No winning move is faster, and all equally fast alternatives are listed.
 * The solver must select a listed move and report a forced or heuristic win.
 */
export const PLY2_FORCED_WINS: readonly GamePosition[] = [
  ['B9 b9 g9', 'e9'],
  ['B9 h1 d2', 'e1'],
  ['B9 a8 b3', 'a5'],
  ['B9 b1 d3', 'e1'],
  ['B9 b1 e3', 'e1'],
  ['B9 i3 i8', 'i5'],
  ['B9 c9 i9', 'e9'],
  ['B9 g1 h2', 'e1'],
  ['B9 g9 c8', 'e9'],
  ['B9 g1 b2', 'e1'],
  ['B9 a3 c1', 'a5'],
  ['B9 a7 c8', 'a5'],
  ['B9 a3 c3', 'a5'],
  ['B9 a3 c4', 'a5'],
  ['B9 c9 e7', 'e9'],
  ['B9 c9 i7', 'e9'],
  ['B9 a3 d1', 'a5'],
  ['B9 c9 b6', 'e9'],
  ['B9 c1 c4', 'e1'],
  ['B9 i3 f4', 'i5'],
  ['B9 c1 e4', 'e1'],
  ['B9 g1 d4', 'e1'],
  ['B9 i7 f3', 'i5'],
  ['B9 i7 f2', 'i5'],
  ['B9 i3 e1', 'i5'],
  ['B9 c1 b5', 'e1'],
  ['B9 g9 g5', 'e9'],
  ['B9 g1 f5', 'e1'],
  ['B9 i7 e5', 'i5'],
  ['B9 a7 e4', 'a5'],
  ['B9 g9 c5', 'e9'],
  ['B9 g9 a5', 'e9'],
  ['B9 g1 g6', 'e1'],
  ['B9 c1 h6', 'e1'],
  ['B9 i3 c9', 'i5'],
  ['B9 i7 b4', 'i5'],
  ['B9 i7 b2', 'i5'],
  ['B9 a3 h9', 'a5'],
  ['B9 a7 i8', 'a5'],
  ['B9 c1 c9', 'e1'],
  ['B9 g9 f1', 'e9'],
  ['B9 a7 i5', 'a5'],
  ['B9 c9 f1', 'e9'],
  ['B9 i3 a8', 'i5'],
  ['B9 f1 i1', 'd1'],
  ['B9 i6 h9', 'i4'],
  ['B9 f9 h8', 'd9'],
  ['B9 d9 h8', 'f9'],
  ['B9 a6 b1', 'a4', 'a5'],
  ['B9 a4 c1', 'a6'],
  ['B9 i6 g8', 'i4', 'i5'],
  ['B9 a6 c7', 'a4', 'a5'],
  ['B9 d1 d3', 'e1', 'f1'],
  ['B9 a6 c4', 'a4', 'a5'],
  ['B9 a4 c7', 'a5', 'a6'],
  ['B9 i6 g2', 'i4', 'i5'],
  ['B9 d9 i7', 'e9', 'f9'],
  ['B9 d9 a6', 'e9', 'f9'],
  ['B9 d1 b4', 'e1', 'f1'],
  ['B9 i4 f3', 'i5', 'i6'],
  ['B9 a4 d4', 'a5', 'a6'],
  ['B9 a6 d4', 'a4', 'a5'],
  ['B9 i6 f3', 'i4', 'i5'],
  ['B9 a6 d2', 'a4', 'a5'],
  ['B9 d1 i4', 'e1', 'f1'],
  ['B9 f9 i5', 'd9', 'e9'],
  ['B9 d9 b5', 'e9', 'f9'],
  ['B9 a4 e8', 'a5', 'a6'],
  ['B9 f1 g6', 'd1', 'e1'],
  ['B9 f1 b6', 'd1', 'e1'],
  ['B9 i4 d9', 'i5', 'i6'],
  ['B9 d9 i3', 'e9', 'f9'],
  ['B9 a4 h1', 'a5', 'a6'],
  ['B9 d1 b8', 'e1', 'f1'],
  ['B9 f9 d2', 'd9', 'e9'],
  ['B9 i4 b9', 'i5', 'i6'],
  ['B9 f9 h1', 'd9', 'e9'],
  ['B9 f1 d9', 'd1', 'e1'],
  ['B9 d1 h9', 'e1', 'f1'],
  ['B9 i6 a1', 'i4', 'i5'],
  ['B9 i5 i9', 'i2', 'i3'],
  ['B9 e1 a2', 'f1', 'g1', 'h1'],
  ['B9 i5 h2', 'i3', 'i7', 'i8'],
  ['B9 e9 g8', 'b9', 'c9'],
  ['B9 e1 a3', 'c1', 'f1', 'g1', 'h1'],
  ['B9 a5 c3', 'a2', 'a3', 'a4', 'a6', 'a7', 'a8'],
  ['B9 a5 d1', 'a2', 'a3', 'a4', 'a6', 'a7', 'a8'],
  ['B9 e9 h6', 'b9', 'c9', 'd9', 'f9', 'g9', 'h9'],
  ['B9 e9 g6', 'b9', 'c9', 'd9', 'f9', 'g9', 'h9'],
  ['B9 i5 f4', 'i2', 'i3', 'i4', 'i6', 'i7', 'i8'],
  ['B9 e1 i5', 'b1', 'c1', 'd1', 'f1', 'g1', 'h1'],
  ['B9 a5 e2', 'a2', 'a3', 'a4', 'a6', 'a7', 'a8'],
  ['B9 e1 b6', 'b1', 'c1', 'd1', 'f1', 'g1', 'h1'],
  ['B9 a5 g9', 'a2', 'a3', 'a4', 'a6', 'a7', 'a8'],
  ['B9 e9 a2', 'b9', 'c9', 'd9', 'f9', 'g9', 'h9'],
  ['B9 e9 h2', 'b9', 'c9', 'd9', 'f9', 'g9', 'h9'],
  ['B9 i5 b6', 'i2', 'i3', 'i4', 'i6', 'i7', 'i8'],
  ['B9 i5 a8', 'i2', 'i3', 'i4', 'i6', 'i7', 'i8'],
  ['B9 a5 i3', 'a2', 'a3', 'a4', 'a6', 'a7', 'a8'],
  ['B9 e1 e9', 'b1', 'c1', 'd1', 'f1', 'g1', 'h1'],
].map(([encoded, ...winningMoves]) => ({
  id: `ply2-${encoded.slice(3).replaceAll(' ', '-')}`,
  encoded,
  toMove: BLACK,
  searchOptions: { maxDepth: 30, quiescenceDepth: 4, maxPly: 64 },
  timeLimitMs: 1250,
  expectedResult: { allowedMoves: winningMoves.map(move => decodeMove(move, 9)), requireWin: true as const },
}));

export const GAME_POSITIONS: readonly GamePosition[] = [
  ...PLY2_FORCED_WINS,
  {
    id: 'ply2-i1-g6',
    encoded: 'B9 i1 g6',
    toMove: BLACK,
    searchOptions: { maxDepth: 30, quiescenceDepth: 4, maxPly: 64 },
    timeLimitMs: 12250,
    expectedResult: { forcedWin: true, timedOut: false },
  },
  {
    id: 'ply2-f9-h9',
    encoded: 'B9 f9 h9',
    toMove: BLACK,
    searchOptions: { maxDepth: 30, quiescenceDepth: 4, maxPly: 64 },
    timeLimitMs: 45500,
    expectedResult: { forcedWin: true, timedOut: false },
  },
  {
    id: 'edge-attack-forced-win',
    encoded: 'B9 e9 e8 f9 g9',
    toMove: BLACK,
    searchOptions: { maxDepth: 30, quiescenceDepth: 4 },
    timeLimitMs: 250,
    expectedResult: { forcedWin: true, timedOut: false },
  },
  {
    id: 'edge-forced-loss',
    encoded: 'B9 e9 e8 f9',
    toMove: WHITE,
    searchOptions: { maxDepth: 30, quiescenceDepth: 4 },
    timeLimitMs: 1000,
    expectedResult: { forcedLoss: true, heuristicLoss: true, timedOut: false },
  },
];
