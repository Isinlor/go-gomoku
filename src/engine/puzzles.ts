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
];

export function getPuzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}
