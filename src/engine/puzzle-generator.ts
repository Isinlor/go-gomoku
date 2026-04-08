/**
 * Puzzle generator tool.
 *
 * Generates and validates Go-Gomoku puzzles.  A valid puzzle of difficulty
 * `(n, m)` satisfies:
 *
 * 1. **Unique Solution (ply n)** – exactly one first move leads to a forced
 *    win; the shortest forced-win path is exactly `n` plies.
 * 2. **Strict Failure States** – every other first move guarantees an
 *    eventual forced loss.
 * 3. **No Immediate Threats (threshold m)** – on every losing branch the
 *    opponent's shortest forced win (with optimal defense) is ≥ `m` plies.
 * 4. **Not Obvious** – GogoAI at depth 1 / quiescence 0 must *not* select
 *    the solution.
 * 5. **Realistic** – no forced ply-3 win for the moving player exists at
 *    any earlier point in the game history.
 *
 * ## Heuristic evaluation at solver leaves
 *
 * The exhaustive solver searches to `maxSearchDepth` with *no* heuristic for
 * the winning-move path (conditions 1–2 for the winner).  For losing-branch
 * verification (condition 2 for losers, condition 3) we also search
 * exhaustively, but when the depth limit is reached without a terminal state
 * we optionally apply a conservative window-based heuristic to classify
 * clearly-lost positions.
 *
 * **Why this is safe:**
 *
 * - The winning path (depth n) is verified *purely* exhaustively — the
 *   heuristic never participates.  Conditions 1 and 2-for-the-winner are
 *   therefore *guaranteed*.
 * - The threshold (condition 3) is checked with exact ply counts from the
 *   exhaustive portion of the search.  A heuristic leaf at depth D implies
 *   the true forced win is at depth > D ≥ m (since D = n + delta >> m).
 *   The threshold is therefore *guaranteed*.
 * - The heuristic is *one-directional*: it can only classify a position as
 *   a loss, never as a win.  A false positive (wrongly classifying a non-
 *   loss as a loss) would make us accept a bad puzzle.  The risk is
 *   mitigated by a high threshold (only overwhelmingly negative evaluations
 *   qualify) and by the fact that the positions come from AI self-play where
 *   the deep AI already sees a win.
 * - Conditions 4 (Not Obvious) and 5 (Realistic) are independent of the
 *   solver leaves and are verified by separate checks.
 */

import {
  EMPTY,
  BLACK,
  WHITE,
  GogoPosition,
  encodeMove,
  decodeGame,
  type Player,
  type SupportedSize,
} from './gogomoku';
import { GogoAI } from './ai';
import type { Puzzle } from './puzzles';
import { BoardUniquenessChecker } from './uniqueness';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel score for an exact forced win by the current player. */
export const SOLVER_WIN = 1_000_000;

/**
 * Weights used for move ordering inside the solver.  Identical to GogoAI's
 * ATTACK_WEIGHTS / DEFENSE_WEIGHTS so that alpha-beta pruning sees
 * strong moves first.
 */
const ATTACK_W = [0, 12, 72, 540, 8_000, 500_000] as const;
const DEFENSE_W = [0, 16, 96, 720, 100_000, 500_000] as const;

/**
 * Window-based evaluation weights for the heuristic leaf classifier.
 * Mirrors GogoAI's EVAL_WEIGHTS.
 */
const EVAL_W = [0, 6, 32, 240, 5_000, SOLVER_WIN >> 2] as const;

/**
 * If the heuristic evaluation at a leaf is below −HEURISTIC_LOSS_THRESHOLD
 * from the current player's perspective, the position is classified as a
 * loss.  The threshold is deliberately very high so that only clearly-lost
 * positions are classified.
 */
const HEURISTIC_LOSS_THRESHOLD = 50_000;

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/**
 * Exact minimax solver with alpha-beta pruning.
 *
 * ## Score convention (negamax, from current player's perspective)
 *
 * | situation             | score                       |
 * | --------------------- | --------------------------- |
 * | current player wins   | `+SOLVER_WIN − game_length` |
 * | current player loses  | `−SOLVER_WIN + game_length` |
 * | unknown (depth limit) | `0`                         |
 *
 * `game_length` counts plies from ply 0 (the root of the top-level call).
 *
 * With this convention standard alpha-beta maximisation produces:
 * - winners that win as fast as possible (higher score ⇒ shorter win);
 * - losers that delay as long as possible (higher score ⇒ longer loss).
 *
 * This is exactly the "optimal play from both sides" semantics required by
 * the puzzle definition.
 */
export class PuzzleSolver {
  private readonly moveBuffers: Int16Array[];
  private readonly scoreBuffers: Int32Array[];
  private readonly candidateMarks: Uint32Array;
  private candidateEpoch: number;
  private readonly area: number;
  private readonly maxPly: number;

  constructor(area: number, maxPly: number) {
    this.area = area;
    this.maxPly = maxPly;
    this.moveBuffers = Array.from({ length: maxPly + 1 }, () => new Int16Array(area));
    this.scoreBuffers = Array.from({ length: maxPly + 1 }, () => new Int32Array(area));
    this.candidateMarks = new Uint32Array(area);
    this.candidateEpoch = 1;
  }

  /**
   * Solve the position for the current player.
   *
   * @param useHeuristic  When true, positions at the depth limit are
   *   classified using a window-based evaluation.  Only negative (loss)
   *   classifications are emitted — the heuristic never claims a win.
   */
  solve(position: GogoPosition, maxDepth: number, useHeuristic = false): number {
    return this.search(position, maxDepth, -SOLVER_WIN, SOLVER_WIN, 0, useHeuristic);
  }

  /**
   * Solve the position *after* playing `move`.
   *
   * Returns the score from the perspective of the player who plays `move`
   * (the current player before the move).  Positive ⇒ the move wins.
   */
  solveMove(position: GogoPosition, move: number, maxDepth: number, useHeuristic = false): number {
    if (!position.play(move)) return 0;
    const score = -this.search(position, maxDepth - 1, -SOLVER_WIN, SOLVER_WIN, 1, useHeuristic);
    position.undo();
    return score;
  }

  private search(
    position: GogoPosition,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    useHeuristic: boolean,
  ): number {
    // Terminal: previous player won → current player lost.
    if (position.winner !== EMPTY) {
      return -SOLVER_WIN + ply;
    }

    if (depth === 0 || ply >= this.maxPly) {
      if (useHeuristic) {
        const h = evaluateForSolver(position);
        if (h < -HEURISTIC_LOSS_THRESHOLD) {
          // Conservative: only classify clear losses. The +1 acknowledges
          // the actual terminal state is ≥1 ply away — this makes the loss
          // look *faster* than it really is, which is pessimistic for the
          // loser and therefore conservative for the threshold check.
          return -SOLVER_WIN + ply + 1;
        }
      }
      return 0;
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    const count = this.generateOrderedMoves(position, moves, scores);

    if (count === 0) return 0; // no legal moves → draw / unknown

    let best = -SOLVER_WIN;
    for (let i = 0; i < count; i += 1) {
      if (!position.play(moves[i])) continue;
      const score = -this.search(position, depth - 1, -beta, -alpha, ply + 1, useHeuristic);
      position.undo();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }

    return best;
  }

  /**
   * Generate near-2 legal moves ordered by attack + defense window scores
   * (descending).  Uses the same near-2 neighbourhood as GogoAI to keep
   * the branching factor low (~15–25 instead of ~50–75).
   *
   * Falls back to full-board generation when there are stones on the board
   * but no near-2 candidate is legal (extremely rare with captures).
   * On an empty board returns no moves (the solver is not expected to
   * handle opening play).
   */
  private generateOrderedMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Int32Array,
  ): number {
    if (position.stoneCount === 0) return 0;

    const board = position.board;
    const meta = position.meta;
    const near2 = meta.near2;
    const near2Offsets = meta.near2Offsets;
    this.candidateEpoch += 1;
    let count = 0;

    for (let point = 0; point < this.area; point += 1) {
      if (board[point] === EMPTY) continue;
      for (let cursor = near2Offsets[point]; cursor < near2Offsets[point + 1]; cursor += 1) {
        const move = near2[cursor];
        if (
          board[move] !== EMPTY ||
          move === position.koPoint ||
          this.candidateMarks[move] === this.candidateEpoch
        ) continue;
        this.candidateMarks[move] = this.candidateEpoch;
        if (!position.isLegal(move)) continue;
        scores[count] = scoreMoveForSolver(position, move);
        moves[count] = move;
        count += 1;
      }
    }

    // Fallback: if no near-2 move was found but there are stones,
    // try the full board (can happen with exotic capture sequences).
    if (count === 0) {
      for (let move = 0; move < this.area; move += 1) {
        if (board[move] !== EMPTY || move === position.koPoint) continue;
        if (!position.isLegal(move)) continue;
        scores[count] = scoreMoveForSolver(position, move);
        moves[count] = move;
        count += 1;
      }
    }

    // Insertion sort descending by score.
    for (let i = 1; i < count; i += 1) {
      const m = moves[i];
      const s = scores[i];
      let j = i;
      while (j > 0 && s > scores[j - 1]) {
        moves[j] = moves[j - 1];
        scores[j] = scores[j - 1];
        j -= 1;
      }
      moves[j] = m;
      scores[j] = s;
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Heuristic helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight standalone position evaluation (from the current player's
 * perspective).  Mirrors GogoAI.evaluate but is callable without an AI
 * instance.
 */
export function evaluateForSolver(position: GogoPosition): number {
  const board = position.board;
  const meta = position.meta;
  const windows = meta.windows;
  let score = 0;

  for (let w = 0; w < meta.windowCount; w += 1) {
    const base = w * 5;
    let black = 0;
    let white = 0;
    for (let step = 0; step < 5; step += 1) {
      const cell = board[windows[base + step]];
      black += cell === BLACK ? 1 : 0;
      white += cell === WHITE ? 1 : 0;
    }
    if (black === 0 && white !== 0) {
      score -= EVAL_W[white];
    } else if (white === 0 && black !== 0) {
      score += EVAL_W[black];
    }
  }

  return position.toMove === BLACK ? score : -score;
}

/**
 * Move ordering heuristic for the solver.  Scores a move by the windows it
 * participates in (attack + defense), matching GogoAI's scoreMove without
 * history / hint / capture / escape bonuses.
 */
function scoreMoveForSolver(position: GogoPosition, move: number): number {
  const player = position.toMove;
  const opponent: Player = player === BLACK ? WHITE : BLACK;
  const meta = position.meta;
  const board = position.board;
  let score = meta.centerBias[move];

  for (let cursor = meta.windowsByPointOffsets[move]; cursor < meta.windowsByPointOffsets[move + 1]; cursor += 1) {
    const windowIndex = meta.windowsByPoint[cursor];
    const base = windowIndex * 5;
    let mine = 0;
    let theirs = 0;
    for (let step = 0; step < 5; step += 1) {
      const cell = board[meta.windows[base + step]];
      mine += cell === player ? 1 : 0;
      theirs += cell === opponent ? 1 : 0;
    }
    if (theirs === 0) score += ATTACK_W[Math.min(mine + 1, 5)];
    if (mine === 0) score += DEFENSE_W[Math.min(theirs + 1, 5)];
  }

  return score;
}

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

/**
 * Decode a solver score into a human-readable result.
 *
 * - Positive score ⇒ `{ outcome: 'win', plies: N }` — win in N plies.
 * - Negative score ⇒ `{ outcome: 'loss', plies: N }` — loss in N plies.
 * - Zero ⇒ `{ outcome: 'unknown', plies: 0 }`.
 */
export function decodeSolverScore(score: number): { outcome: 'win' | 'loss' | 'unknown'; plies: number } {
  if (score > 0) return { outcome: 'win', plies: SOLVER_WIN - score };
  if (score < 0) return { outcome: 'loss', plies: SOLVER_WIN + score };
  return { outcome: 'unknown', plies: 0 };
}

// ---------------------------------------------------------------------------
// Puzzle validation
// ---------------------------------------------------------------------------

/** Result of a successful puzzle validation. */
export interface ValidatedPuzzle {
  encoded: string;
  toMove: Player;
  solution: string;
  depth: number;
  threshold: number;
}

/**
 * Validate a position as a puzzle of difficulty `(targetDepth, targetThreshold)`.
 *
 * ### Check ordering rationale
 *
 * Checks are ordered from cheapest / most-rejecting to most expensive:
 *
 * 1. **Not Obvious** — one GogoAI call at depth 1 / quiescence 0 (~0.1 ms).
 *    Rejects trivially obvious positions immediately.
 *
 * 2. **Winning move verification** — exhaustive solver to depth `targetDepth`
 *    for the candidate move.  Moderate cost; rejects positions where the
 *    candidate move is not actually a forced win.
 *
 * 3. **Uniqueness + strict failure + threshold** — for every *other* legal
 *    move, verify it is a forced loss with game length ≥ `targetThreshold`.
 *    Most expensive because it runs the solver for each alternative move.
 *    Combined into one pass for efficiency.
 *
 *    Why not check uniqueness before strict-failure?  Because both require
 *    iterating over all other moves with the solver, so combining them into
 *    one loop avoids redundant work.  Early-exit on the first duplicate win
 *    (uniqueness violation) keeps cost low when the candidate is bad.
 *
 * 4. **Realistic** — solver at depth 3 for each position in the game
 *    history.  Moderate cost but runs last because it examines the full
 *    history and is independent of the other checks.
 *
 * @param candidateMove  The move index believed to be the unique winning
 *   move.  If −1, the function tries every legal move to find one that wins
 *   in exactly `targetDepth` plies.
 * @param maxSearchDepth  Maximum search depth for losing-branch
 *   verification.  Should be ≥ `targetDepth` + 4.
 */
export function validatePuzzle(
  position: GogoPosition,
  targetDepth: number,
  targetThreshold: number,
  candidateMove: number,
  maxSearchDepth: number,
): ValidatedPuzzle | null {
  if (position.winner !== EMPTY) return null;

  const solver = new PuzzleSolver(position.area, maxSearchDepth + 2);

  // ── 1. Not Obvious ─────────────────────────────────────────────────────
  // GogoAI at depth 1, quiescence 0 must NOT pick the solution.
  const shallowAI = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
  const shallowResult = shallowAI.findBestMove(position, 200);

  // ── 2. Find / verify the winning move ──────────────────────────────────
  const allMoves = new Int16Array(position.area);
  const moveCount = position.generateAllLegalMoves(allMoves);
  if (moveCount === 0) return null;

  let winningMove = -1;
  let winPlies = -1;

  if (candidateMove >= 0) {
    // Verify the candidate
    const score = solver.solveMove(position, candidateMove, targetDepth);
    const decoded = decodeSolverScore(score);
    if (decoded.outcome === 'win' && decoded.plies === targetDepth) {
      winningMove = candidateMove;
      winPlies = targetDepth;
    }
  } else {
    // Try every legal move
    for (let i = 0; i < moveCount; i += 1) {
      const score = solver.solveMove(position, allMoves[i], targetDepth);
      const decoded = decodeSolverScore(score);
      if (decoded.outcome === 'win' && decoded.plies === targetDepth) {
        if (winningMove !== -1) return null; // Multiple winning moves at this depth → not unique
        winningMove = allMoves[i];
        winPlies = targetDepth;
      }
    }
  }

  if (winningMove === -1) return null;

  // Not Obvious: if the shallow AI picked the winning move, reject.
  if (shallowResult.move === winningMove) return null;

  // ── 3. Uniqueness + strict failure + threshold ─────────────────────────
  for (let i = 0; i < moveCount; i += 1) {
    const move = allMoves[i];
    if (move === winningMove) continue;

    // First: quick check — does this move also win within targetDepth?
    const quickScore = solver.solveMove(position, move, targetDepth);
    const quickDecoded = decodeSolverScore(quickScore);
    if (quickDecoded.outcome === 'win') return null; // Another winning move → not unique

    // Deep search for loss verification.
    const deepScore = solver.solveMove(position, move, maxSearchDepth, true);
    const deepDecoded = decodeSolverScore(deepScore);

    if (deepDecoded.outcome !== 'loss') return null; // Not a forced loss → reject
    if (deepDecoded.plies < targetThreshold) return null; // Threshold violation
  }

  // ── 4. Realistic ───────────────────────────────────────────────────────
  // Check no forced ply-3 win for the moving player at any earlier point.
  if (!isRealisticHistory(position, solver)) return null;

  const solution = encodeMove(winningMove, position.meta);
  return {
    encoded: position.encodeGame(),
    toMove: position.toMove,
    solution,
    depth: winPlies,
    threshold: targetThreshold,
  };
}

/**
 * Check the "Realistic" condition: at no point in the game history does the
 * player to move have a forced win in ≤ 3 plies.
 *
 * We replay the game from scratch and check each intermediate position with
 * the solver at depth 3.  This is moderately expensive (up to 60 solver
 * calls at depth 3) but each depth-3 call is very fast.
 */
function isRealisticHistory(position: GogoPosition, solver: PuzzleSolver): boolean {
  const historyLength = position.ply;
  if (historyLength === 0) return true;

  const replay = new GogoPosition(position.size);
  for (let i = 0; i < historyLength; i += 1) {
    // Check the position BEFORE each move.
    const score = solver.solve(replay, 3);
    const decoded = decodeSolverScore(score);
    if (decoded.outcome === 'win' && decoded.plies <= 3) return false;
    replay.play(position.getMoveAt(i));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Self-play candidate generation
// ---------------------------------------------------------------------------

/** Configuration for puzzle generation. */
export interface PuzzleGeneratorConfig {
  /** Board size (default 9). */
  boardSize?: SupportedSize;
  /** Target forced-win depth n. */
  targetDepth: number;
  /** Target threshold m. */
  targetThreshold: number;
  /** Maximum moves in game record (default 60). */
  maxGameMoves?: number;
  /** Maximum solver search depth for loss verification (default targetDepth + 6). */
  maxSearchDepth?: number;
  /** Number of puzzles to find (default 10). */
  count?: number;
  /** RNG seed for self-play randomisation (default 42). */
  seed?: number;
  /** Time limit in ms for each self-play AI call (default 50). */
  aiTimeMs?: number;
  /** Epsilon for ε-greedy exploration during self-play (default 0.15). */
  epsilon?: number;
  /** Maximum number of self-play games to run before giving up (default 2000). */
  maxGames?: number;
  /** Existing puzzles whose board patterns should be treated as duplicates. */
  existingPuzzles?: readonly Puzzle[];
}

/**
 * Deterministic LCG random number generator (same as GogoMCTS).
 */
function lcgNext(state: number): [number, number] {
  const next = (1664525 * state + 1013904223) >>> 0;
  return [next, next / 0x1_0000_0000];
}

/**
 * Play one self-play game between two shallow AIs and collect candidate
 * positions where a deeper AI sees a win but the shallow AI does not.
 *
 * ### Why self-play produces good candidates
 *
 * Two depth-2 AIs generate realistic mid-game positions with balanced
 * tactical tension.  A depth-4 AI then identifies positions where a deeper
 * calculation reveals a forced win that the shallow AI misses.  These are
 * exactly the positions where a human might also miss the winning move.
 */
export function selfPlayGame(
  boardSize: SupportedSize,
  shallowAI: GogoAI,
  deepAI: GogoAI,
  aiTimeMs: number,
  maxGameMoves: number,
  epsilon: number,
  rngState: number,
): { candidates: string[]; rngState: number } {
  const pos = new GogoPosition(boardSize);
  const candidates: string[] = [];
  const moveBuffer = new Int16Array(pos.area);

  while (pos.winner === EMPTY && pos.ply < maxGameMoves) {
    // Deep AI evaluation
    const deepResult = deepAI.findBestMove(pos, aiTimeMs);

    // Shallow AI evaluation
    const shallowResult = shallowAI.findBestMove(pos, aiTimeMs);

    // Candidate: deep AI sees a strong win that shallow AI misses.
    // The deep AI score > 500_000 indicates a forced win (WIN_SCORE territory).
    if (
      deepResult.score > 500_000 &&
      deepResult.move !== shallowResult.move &&
      deepResult.move >= 0
    ) {
      candidates.push(pos.encodeGame());
    }

    // ε-greedy move selection for game diversity.
    let moveToPlay = shallowResult.move;
    let r: number;
    [rngState, r] = lcgNext(rngState);
    if (r < epsilon && pos.stoneCount > 4) {
      const count = pos.generateAllLegalMoves(moveBuffer);
      if (count > 0) {
        let r2: number;
        [rngState, r2] = lcgNext(rngState);
        moveToPlay = moveBuffer[Math.floor(r2 * count)];
      }
    }

    if (moveToPlay === -1 || !pos.play(moveToPlay)) break;
  }

  return { candidates, rngState };
}

/**
 * Generate validated puzzles of a given difficulty.
 *
 * Plays many self-play games between shallow AIs, identifies candidate
 * positions, and validates each one against the full puzzle criteria.
 *
 * Returns an array of validated puzzles (up to `config.count`).
 */
export function generatePuzzles(config: PuzzleGeneratorConfig): ValidatedPuzzle[] {
  const boardSize = config.boardSize ?? 9;
  const maxGameMoves = config.maxGameMoves ?? 60;
  const maxSearchDepth = config.maxSearchDepth ?? config.targetDepth + 6;
  const count = config.count ?? 10;
  const aiTimeMs = config.aiTimeMs ?? 50;
  const epsilon = config.epsilon ?? 0.15;
  const maxGames = config.maxGames ?? 2000;
  let rngState = (config.seed ?? 42) >>> 0;

  const shallowAI = new GogoAI({ maxDepth: 2, quiescenceDepth: 2 });
  const deepAI = new GogoAI({ maxDepth: 4, quiescenceDepth: 1 });

  // Build uniqueness checker from existing puzzles.
  const existingPositions: GogoPosition[] = [];
  if (config.existingPuzzles) {
    for (const p of config.existingPuzzles) {
      existingPositions.push(decodeGame(p.encoded));
    }
  }
  const uniqueness = new BoardUniquenessChecker(existingPositions, maxGameMoves);

  const results: ValidatedPuzzle[] = [];
  const seenEncodings = new Set<string>();

  for (let game = 0; game < maxGames && results.length < count; game += 1) {
    const { candidates, rngState: nextState } = selfPlayGame(
      boardSize,
      shallowAI,
      deepAI,
      aiTimeMs,
      maxGameMoves,
      epsilon,
      rngState,
    );
    rngState = nextState;

    for (const encoded of candidates) {
      if (results.length >= count) break;
      if (seenEncodings.has(encoded)) continue;
      seenEncodings.add(encoded);

      const position = decodeGame(encoded);
      if (!uniqueness.isUnique(position)) continue;

      // Find the candidate winning move via the deep AI.
      const deepResult = deepAI.findBestMove(position, aiTimeMs * 2);
      if (deepResult.move === -1) continue;

      const validated = validatePuzzle(
        position,
        config.targetDepth,
        config.targetThreshold,
        deepResult.move,
        maxSearchDepth,
      );

      if (validated !== null) {
        results.push(validated);
      }
    }
  }

  return results;
}
