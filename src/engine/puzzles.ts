import type { Player } from './gogomoku';
import { BLACK, WHITE } from './gogomoku';

/**
 * A puzzle has a unique winning first move from the initial position.
 *
 * Difficulty is written as `(n, m)` where:
 * - `n` = depth of the shortest forced-win path (plies from depth 0).
 * - `m` = minimum depth (plies from depth 0) for the opponent to win
 *   on every *losing* branch at depth 0.
 */
export interface Puzzle {
  /** Human-readable identifier. */
  readonly id: string;
  /** Encoded game string that produces the puzzle starting position. */
  readonly encoded: string;
  /** Which player is to move and must find the winning move. */
  readonly toMove: Player;
  /** The unique winning first move in algebraic notation (e.g. "e5"). */
  readonly solution: string;
  /** Forced-win depth `n`. */
  readonly depth: number;
  /** Opponent-win threshold `m`. */
  readonly threshold: number;
}

export const PUZZLES: readonly Puzzle[] = [
  // Black to move
  {
    id: 'black-3-3',
    encoded: 'B9 c5 e3 d5 e4 f5 e6',
    toMove: BLACK,
    solution: 'e5',
    depth: 3,
    threshold: 3,
  },
  {
    id: 'black-5-3',
    encoded: 'B9 e2 a1 e3 c1 b5 g1 c5 i1 d5 a5 a9 g3 c9 f4 i9 d6',
    toMove: BLACK,
    solution: 'e5',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-7-5',
    encoded: 'B9 e2 a5 e3 e6 b5 f5 c5 g5 d5 h5 b2 g3 c3 h2',
    toMove: BLACK,
    solution: 'e5',
    depth: 7,
    threshold: 5,
  },
  // White to move
  {
    id: 'white-3-3',
    encoded: 'B9 e3 c5 e4 d5 e6 f5 a1',
    toMove: WHITE,
    solution: 'e5',
    depth: 3,
    threshold: 3,
  },
  {
    id: 'white-5-3',
    encoded: 'B9 a1 e2 c1 e3 g1 b5 i1 c5 a5 d5 g3 a9 f4 c9 d6 i9 h9',
    toMove: WHITE,
    solution: 'e5',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'white-7-5',
    encoded: 'B9 i9 e2 a5 e3 e6 b5 f5 c5 g5 d5 h5 b2 g3 c3 h2',
    toMove: WHITE,
    solution: 'e5',
    depth: 7,
    threshold: 5,
  },
  // Generated (5, 3) puzzles
  {
    id: 'black-5-3-gen1',
    encoded: 'B9 f6 e5 f4 e3 e7 e2 e4 d4 c5 f8 f3 f5 g5 d8 h4 i3',
    toMove: BLACK,
    solution: 'i4',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'white-5-3-gen2',
    encoded: 'B9 e2 f6 h5 e5 d4 d6 g4 f3 f4 e4 g6',
    toMove: WHITE,
    solution: 'e7',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen3',
    encoded: 'B9 d5 b5 f3 e4 e6 c4 f5 d3 e2 b4 f4 f6',
    toMove: BLACK,
    solution: 'f1',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen4',
    encoded: 'B9 b5 g4 f6 e5 c6 e6 d7 e8 e7 c7 g5 d8 b7 f7 c8 a7',
    toMove: BLACK,
    solution: 'c5',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen5',
    encoded: 'B9 g5 d3 g6 e5 f4 g7 e3 d2 h6 i7 f6 e6 e7 h4 d8 c9 c5 f2 d6 b4 d4 e1',
    toMove: BLACK,
    solution: 'd5',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen6',
    encoded: 'B9 g5 d3 f6 e7 e5 f4 d5 f5 e4 g4 f3 c6 g7 d4 e6 c5',
    toMove: BLACK,
    solution: 'h6',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'white-5-3-gen7',
    encoded: 'B9 e7 e5 d6 c5 g5 f6 g7 d4 e3 c3 b2 f4 f7 d7 d8 c7 h7 i7 c6',
    toMove: WHITE,
    solution: 'e4',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen8',
    encoded: 'B9 c5 e5 e3 d4 c3 f4 d6 e7 c4 c6 c7 b6 d3 f3 a6 f6 b5 e2',
    toMove: BLACK,
    solution: 'b7',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen9',
    encoded: 'B9 g5 d4 e5 d5 d6 f4 e6 c6 e4 e7 e2 e3 d3 f3 f5 g6 b5 c4 c2 b1 f2 g2',
    toMove: BLACK,
    solution: 'b2',
    depth: 5,
    threshold: 3,
  },
  {
    id: 'black-5-3-gen10',
    encoded: 'B9 f6 f3 e5 d4 d6 e7 f4 c7 h2 g3 e3 h6 f8 f7 g7 e2 c6 b6 d7 h8',
    toMove: BLACK,
    solution: 'e8',
    depth: 5,
    threshold: 3,
  },
];

export function getPuzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}
