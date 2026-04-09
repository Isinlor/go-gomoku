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
  /** Encoded board state after the complete winning sequence is played out. */
  readonly wonEncoded: string;
  /** The full winning sequence as move strings (solution + responses). */
  readonly winningMoves: readonly string[];
}

export const PUZZLES: readonly Puzzle[] = [
  // ---- Hand-crafted puzzles -------------------------------------------
  // Black to move
  {
    id: 'black-3-3',
    encoded: 'B9 c5 e3 d5 e4 f5 e6',
    toMove: BLACK,
    solution: 'e5',
    depth: 3,
    threshold: 3,
    wonEncoded: 'B9 c5 e3 d5 e4 f5 e6 e5 a1 b1 c1 b5',
    winningMoves: ['e5', 'a1', 'b1', 'c1', 'b5'],
  },
  {
    id: 'black-5-3',
    encoded: 'B9 e2 a1 e3 c1 b5 g1 c5 i1 d5 a5 a9 g3 c9 f4 i9 d6',
    toMove: BLACK,
    solution: 'e5',
    depth: 5,
    threshold: 3,
    wonEncoded: 'B9 e2 a1 e3 c1 b5 g1 c5 i1 d5 a5 a9 g3 c9 f4 i9 d6 e5 b1 d1 e1 e4 f1 f5',
    winningMoves: ['e5', 'b1', 'd1', 'e1', 'e4', 'f1', 'f5'],
  },
  {
    id: 'black-7-5',
    encoded: 'B9 e2 a5 e3 e6 b5 f5 c5 g5 d5 h5 b2 g3 c3 h2',
    toMove: BLACK,
    solution: 'e5',
    depth: 7,
    threshold: 5,
    wonEncoded: 'B9 e2 a5 e3 e6 b5 f5 c5 g5 d5 h5 b2 g3 c3 h2 e5 a1 b1 c1 b3 d1 e1 f1 b4',
    winningMoves: ['e5', 'a1', 'b1', 'c1', 'b3', 'd1', 'e1', 'f1', 'b4'],
  },
  // White to move
  {
    id: 'white-3-3',
    encoded: 'B9 e3 c5 e4 d5 e6 f5 a1',
    toMove: WHITE,
    solution: 'e5',
    depth: 3,
    threshold: 3,
    wonEncoded: 'B9 e3 c5 e4 d5 e6 f5 a1 e5 b1 c1 d1 b5',
    winningMoves: ['e5', 'b1', 'c1', 'd1', 'b5'],
  },
  {
    id: 'white-5-3',
    encoded: 'B9 a1 e2 c1 e3 g1 b5 i1 c5 a5 d5 g3 a9 f4 c9 d6 i9 h9',
    toMove: WHITE,
    solution: 'e5',
    depth: 5,
    threshold: 3,
    wonEncoded: 'B9 a1 e2 c1 e3 g1 b5 i1 c5 a5 d5 g3 a9 f4 c9 d6 i9 h9 e5 b1 d1 e1 e4 f1 f5',
    winningMoves: ['e5', 'b1', 'd1', 'e1', 'e4', 'f1', 'f5'],
  },
  {
    id: 'white-7-5',
    encoded: 'B9 i9 e2 a5 e3 e6 b5 f5 c5 g5 d5 h5 b2 g3 c3 h2',
    toMove: WHITE,
    solution: 'e5',
    depth: 7,
    threshold: 5,
    wonEncoded: 'B9 i9 e2 a5 e3 e6 b5 f5 c5 g5 d5 h5 b2 g3 c3 h2 e5 a1 b1 c1 b3 d1 e1 f1 b4',
    winningMoves: ['e5', 'a1', 'b1', 'c1', 'b3', 'd1', 'e1', 'f1', 'b4'],
  },

  // ---- Generated beginner puzzles (n=3, m=2, k=0) --------------------
  {
    id: 'gen-beginner-1',
    encoded: 'B9 e5 h4 i3 a8 b6 h8 b8 e1 c6 c5 e8 h1 g3 g1 i1 h2 f1 f6 f5 h3 h5 f2',
    toMove: BLACK,
    solution: 'g5',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 h4 i3 a8 b6 h8 b8 e1 c6 c5 e8 h1 g3 g1 i1 h2 f1 f6 f5 h3 h5 f2 g5 a1 b1 c1 d5',
    winningMoves: ['g5', 'a1', 'b1', 'c1', 'd5'],
  },
  {
    id: 'gen-beginner-2',
    encoded: 'B9 e5 f7 d9 f2 c5 h7 a7 i9 a5 d5 d2 f9 i6 c2 e6 e7 e1',
    toMove: WHITE,
    solution: 'g7',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 f7 d9 f2 c5 h7 a7 i9 a5 d5 d2 f9 i6 c2 e6 e7 e1 g7 a1 b1 c1 d7',
    winningMoves: ['g7', 'a1', 'b1', 'c1', 'd7'],
  },
  {
    id: 'gen-beginner-3',
    encoded: 'B9 e5 b5 d3 e4 d6 f7 f4 g3 c7 b8 h5 c5 g8 d8 f5 i5 e6 d5 a6 b6 b7 h8 e1 c8 d7',
    toMove: WHITE,
    solution: 'e8',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 b5 d3 e4 d6 f7 f4 g3 c7 b8 h5 c5 g8 d8 f5 i5 e6 d5 a6 b6 b7 h8 e1 c8 d7 e8 a1 b1 c1 a8',
    winningMoves: ['e8', 'a1', 'b1', 'c1', 'a8'],
  },
  {
    id: 'gen-beginner-4',
    encoded: 'B9 e5 h6 e2 d4 f5 b6 b1 h5 f4 d5 g5 h4 h2',
    toMove: WHITE,
    solution: 'h7',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 h6 e2 d4 f5 b6 b1 h5 f4 d5 g5 h4 h2 h7 a1 c1 d1 h3',
    winningMoves: ['h7', 'a1', 'c1', 'd1', 'h3'],
  },
  {
    id: 'gen-beginner-5',
    encoded: 'B9 e5 g5 h5 f4 h4 h7 i7 d4 c4 h3 d2 e8 g4 c2 i6 f3 e6 f5 f7',
    toMove: WHITE,
    solution: 'f2',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 g5 h5 f4 h4 h7 i7 d4 c4 h3 d2 e8 g4 c2 i6 f3 e6 f5 f7 f2 a1 b1 c1 f1',
    winningMoves: ['f2', 'a1', 'b1', 'c1', 'f1'],
  },
  {
    id: 'gen-beginner-6',
    encoded: 'B9 e5 d6 e4 d5 d4 c3 h8 f6 e2 e1 a6 e3 a4 c4 a7 a5 d2 a2 b3 f1 c6 g8 f7 g6 h6 d7 d8 f8 g3 b4 c5 f4 g1 g7 c7',
    toMove: WHITE,
    solution: 'g5',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 d6 e4 d5 d4 c3 h8 f6 e2 e1 a6 e3 a4 c4 a7 a5 d2 a2 b3 f1 c6 g8 f7 g6 h6 d7 d8 f8 g3 b4 c5 f4 g1 g7 c7 g5 a1 b1 c1 g4',
    winningMoves: ['g5', 'a1', 'b1', 'c1', 'g4'],
  },
  {
    id: 'gen-beginner-7',
    encoded: 'B9 e5 g5 b8 c6 g6 c7 i9 e2 b6 b5 e8 f2 e3 d8 e4 e7 c9 f6 h4 g2 h2 d2 c2 f5 d7 f4 f3 d3 f7',
    toMove: WHITE,
    solution: 'c4',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 g5 b8 c6 g6 c7 i9 e2 b6 b5 e8 f2 e3 d8 e4 e7 c9 f6 h4 g2 h2 d2 c2 f5 d7 f4 f3 d3 f7 c4 a1 b1 c1 f1',
    winningMoves: ['c4', 'a1', 'b1', 'c1', 'f1'],
  },
  {
    id: 'gen-beginner-8',
    encoded: 'B9 e5 c1 d8 a7 b6 a9 g3 a5 a8 f4 e7 c9 f5 e4 c8 b8 h4',
    toMove: WHITE,
    solution: 'a6',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 c1 d8 a7 b6 a9 g3 a5 a8 f4 e7 c9 f5 e4 c8 b8 h4 a6 a1 b1 d1 a8',
    winningMoves: ['a6', 'a1', 'b1', 'd1', 'a8'],
  },
  {
    id: 'gen-beginner-9',
    encoded: 'B9 e5 c1 i6 g4 f4 b1 c8 g3 g7 c6 a8 a9 e1 e3 g5 i7 d9 e8 a6 h5 a5 a7 g6 d7 h6',
    toMove: WHITE,
    solution: 'b5',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 c1 i6 g4 f4 b1 c8 g3 g7 c6 a8 a9 e1 e3 g5 i7 d9 e8 a6 h5 a5 a7 g6 d7 h6 b5 a1 d1 f1 a4',
    winningMoves: ['b5', 'a1', 'd1', 'f1', 'a4'],
  },
  {
    id: 'gen-beginner-10',
    encoded: 'B9 e5 a8 d6 d7 h5 h6 e7 e9 b9 f7 g9 f8 b8 b6',
    toMove: BLACK,
    solution: 'c7',
    depth: 3,
    threshold: 2,
    wonEncoded: 'B9 e5 a8 d6 d7 h5 h6 e7 e9 b9 f7 g9 f8 b8 b6 c7 a1 b1 c1 f4',
    winningMoves: ['c7', 'a1', 'b1', 'c1', 'f4'],
  },

  // ---- Generated intermediate puzzles (n=5, m=4, k=2) ----------------
  {
    id: 'gen-intermediate-1',
    encoded: 'B9 e5 g2 g4 d5 c3 b8 g3 h9 c4 g5 c2 c1 f6 b2 g7 d4 f7 h8 c5 c6 f3 d3 d2',
    toMove: WHITE,
    solution: 'd7',
    depth: 5,
    threshold: 4,
    wonEncoded: 'B9 e5 g2 g4 d5 c3 b8 g3 h9 c4 g5 c2 c1 f6 b2 g7 d4 f7 h8 c5 c6 f3 d3 d2 d7 a1 b1 d1 d6',
    winningMoves: ['d7', 'a1', 'b1', 'd1', 'd6'],
  },
  {
    id: 'gen-intermediate-2',
    encoded: 'B9 e5 b2 g6 e6 d3 i4 h7 e4 h3 h4 a2 g8 f4 d6 d7 c6 b6 g5 b7 a5 i3 b8 c3 g3 c4 e3 a6 e2 d2 g1 g4 f7 d5 d1 i5 a7 b5 c5',
    toMove: BLACK,
    solution: 'b3',
    depth: 5,
    threshold: 4,
    wonEncoded: 'B9 e5 b2 g6 e6 d3 i4 h7 e4 h3 h4 a2 g8 f4 d6 d7 c6 b6 g5 b7 a5 i3 b8 c3 g3 c4 e3 a6 e2 d2 g1 g4 f7 d5 d1 i5 a7 b5 c5 b3 a1 b1 c1 a4 a1 b4',
    winningMoves: ['b3', 'a1', 'b1', 'c1', 'a4', 'a1', 'b4'],
  },
  {
    id: 'gen-intermediate-3',
    encoded: 'B9 e5 g2 b6 h7 b7 h5 d5 b8 d3 b4 a3 d1 d4 d6 f3 e4 g7 h8',
    toMove: BLACK,
    solution: 'c3',
    depth: 5,
    threshold: 4,
    wonEncoded: 'B9 e5 g2 b6 h7 b7 h5 d5 b8 d3 b4 a3 d1 d4 d6 f3 e4 g7 h8 c3 a1 b1 c1 b2 e1 f6',
    winningMoves: ['c3', 'a1', 'b1', 'c1', 'b2', 'e1', 'f6'],
  },
  {
    id: 'gen-intermediate-4',
    encoded: 'B9 e5 e4 f5 a4 c4 a3 e8 c7 e6 e9 d9 f9 d8 h9 i9 f4 g5 h5 h3 g4',
    toMove: BLACK,
    solution: 'd5',
    depth: 5,
    threshold: 4,
    wonEncoded: 'B9 e5 e4 f5 a4 c4 a3 e8 c7 e6 e9 d9 f9 d8 h9 i9 f4 g5 h5 h3 g4 d5 a1 b1 c1 a2 d1 b3',
    winningMoves: ['d5', 'a1', 'b1', 'c1', 'a2', 'd1', 'b3'],
  },
  {
    id: 'gen-intermediate-5',
    encoded: 'B9 e5 e6 d6 g3 f1 i5 c7 f4 f7 a9 c5 f8 g5 f5 c8 c9 g4 c4 e9 d8 e8 f2 e1',
    toMove: WHITE,
    solution: 'f6',
    depth: 5,
    threshold: 4,
    wonEncoded: 'B9 e5 e6 d6 g3 f1 i5 c7 f4 f7 a9 c5 f8 g5 f5 c8 c9 g4 c4 e9 d8 e8 f2 e1 f6 a1 b1 c1 e3 d1 f3',
    winningMoves: ['f6', 'a1', 'b1', 'c1', 'e3', 'd1', 'f3'],
  },
  {
    id: 'gen-intermediate-6',
    encoded: 'B9 e5 g8 e4 e8 f1 e6 h3 b6 f4 f8 d8 b7 i8 h4 i5 a7 b5 a6 d6 g3 c7 b8 f7 d4 c5 d5 a5 f6 e2 c4',
    toMove: BLACK,
    solution: 'e3',
    depth: 5,
    threshold: 4,
    wonEncoded: 'B9 e5 g8 e4 e8 f1 e6 h3 b6 f4 f8 d8 b7 i8 h4 i5 a7 b5 a6 d6 g3 c7 b8 f7 d4 c5 d5 a5 f6 e2 c4 e3 a1 b1 c1 d1 g1 e1',
    winningMoves: ['e3', 'a1', 'b1', 'c1', 'd1', 'g1', 'e1'],
  },

  // ---- Generated advanced puzzle (n=7, m=4, k=2) ---------------------
  {
    id: 'gen-advanced-1',
    encoded: 'B9 e5 h4 i3 a8 b6 h8 b8 e1 c6 c5 e8 h1 g3 g1 i1 h2 f1 f6 f5',
    toMove: WHITE,
    solution: 'f2',
    depth: 7,
    threshold: 4,
    wonEncoded: 'B9 e5 h4 i3 a8 b6 h8 b8 e1 c6 c5 e8 h1 g3 g1 i1 h2 f1 f6 f5 f2 a1 b1 c1 d1 a2 f1',
    winningMoves: ['f2', 'a1', 'b1', 'c1', 'd1', 'a2', 'f1'],
  },
];

export function getPuzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}
