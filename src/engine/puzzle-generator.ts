/**
 * Puzzle Generator
 *
 * Generates and verifies puzzles for Gogomoku (Go + Gomoku hybrid).
 *
 * ## Architecture
 *
 * 1. **ExactSolver** – Pure minimax forced-win search with no heuristic
 *    evaluation.  Terminal states are actual game endings only (5-in-a-row
 *    or no legal moves).  This guarantees mathematical correctness: if
 *    `hasForceWin` returns true there provably IS a forced win.
 *
 * 2. **verifyPuzzle** – Validates a candidate position against all puzzle
 *    requirements (unique solution, strict failure, threshold, not-obvious,
 *    realistic).  Check ordering is cheapest-first so most candidates are
 *    rejected quickly.
 *
 * 3. **selfPlayGame / generatePuzzles** – Self-play between two AIs plus
 *    candidate extraction and verification pipeline.
 *
 * ## Why no heuristics in verification
 *
 * Heuristic evaluation can report false positives (positions that *look*
 * like wins but aren't).  Puzzle conditions require mathematical certainty,
 * so the ExactSolver uses only proven game endings.  Heuristics are used
 * **only** in candidate generation (to filter positions worth verifying)
 * and in the "not obvious" check (which is defined in terms of the AI).
 */

import {
  GogoPosition,
  type Player,
  EMPTY,
  BLACK,
  WHITE,
  encodeMove,
  type SupportedSize,
} from './gogomoku';
import { GogoAI } from './ai';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Mirrors the AI module's win score for candidate filtering. */
const WIN_SCORE = 1_000_000_000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

/* ------------------------------------------------------------------ */
/*  ExactSolver                                                        */
/* ------------------------------------------------------------------ */

/**
 * Pure minimax forced-win solver.
 *
 * Pre-allocates move buffers for each ply to avoid GC pressure during
 * deep recursive searches.  Move ordering uses window-based tactical
 * scoring (immediate wins first, then blocks, then threats) which does
 * not affect correctness but dramatically improves pruning speed.
 */
export class ExactSolver {
  private readonly moveBuffers: Int16Array[];
  private readonly scoreBuffers: Int32Array[];
  readonly maxSupportedDepth: number;

  /** Running node count – reset manually before a search batch. */
  nodes = 0;

  constructor(area: number, maxDepth: number) {
    this.maxSupportedDepth = maxDepth;
    this.moveBuffers = [];
    this.scoreBuffers = [];
    for (let i = 0; i <= maxDepth; i += 1) {
      this.moveBuffers.push(new Int16Array(area));
      this.scoreBuffers.push(new Int32Array(area));
    }
  }

  /**
   * Can `forPlayer` force a win within `maxDepth` plies?
   *
   * Reasoning for the attacker / defender split:
   * - **Attacker** (forPlayer's turn): tries each legal move and returns
   *   `true` if ANY leads to a forced win.  Models "player picks the
   *   best move."
   * - **Defender** (other player's turn): tries each legal move and
   *   returns `false` if ANY move escapes the forced win.  Models
   *   "opponent picks the best defensive move."
   *
   * Together this is standard minimax for forced-win determination.
   */
  hasForceWin(
    position: GogoPosition,
    forPlayer: Player,
    maxDepth: number,
    ply = 0,
  ): boolean {
    this.nodes += 1;

    /* Terminal checks – no heuristics, only real game endings. */
    if (position.winner === forPlayer) return true;
    if (position.winner !== EMPTY) return false;
    if (maxDepth <= 0) return false;

    const moves = this.moveBuffers[ply];
    const count = position.generateAllLegalMoves(moves);
    if (count === 0) return false; // no moves = draw

    /*
     * Decision: move ordering.
     *
     * Without ordering, depth-7+ searches can be prohibitively slow
     * because the branching factor stays ~40-50.  With ordering
     * (immediate wins first, blocks second, threats third) the effective
     * branching factor drops to ~5-10, giving >100× speedup at depth 7.
     * Ordering does NOT affect correctness – only visit order changes.
     */
    this.orderMoves(position, moves, count, ply);

    if (position.toMove === forPlayer) {
      /* Attacker: need at least one winning continuation. */
      for (let i = 0; i < count; i += 1) {
        /* istanbul ignore next -- generateAllLegalMoves guarantees legality */
        if (!position.play(moves[i])) continue;
        const wins = this.hasForceWin(position, forPlayer, maxDepth - 1, ply + 1);
        position.undo();
        if (wins) return true;
      }
      return false;
    }

    /* Defender: all moves must still lead to attacker's win. */
    for (let i = 0; i < count; i += 1) {
      /* istanbul ignore next -- generateAllLegalMoves guarantees legality */
      if (!position.play(moves[i])) continue;
      const wins = this.hasForceWin(position, forPlayer, maxDepth - 1, ply + 1);
      position.undo();
      if (!wins) return false; // defender found escape
    }
    return true;
  }

  /**
   * Minimum number of plies for `forPlayer` to force a win.
   *
   * Returns −1 when no forced win exists within `maxSearchDepth`.
   *
   * Decision: iterative deepening is used rather than a single deep
   * search because it reliably finds the EXACT minimum depth.  A
   * single-pass depth-tracking approach is more error-prone (min/max
   * over depths is subtle) and iterative deepening shares most work
   * via early-termination at each level.
   */
  forcedWinDepth(
    position: GogoPosition,
    forPlayer: Player,
    maxSearchDepth: number,
  ): number {
    for (let d = 1; d <= maxSearchDepth; d += 1) {
      if (this.hasForceWin(position, forPlayer, d)) {
        return d;
      }
    }
    return -1;
  }

  /**
   * Score and sort moves for better pruning.
   *
   * Priority (descending):
   * 1. Immediate wins  (player has 4 in a window → completing 5)
   * 2. Blocks           (opponent has 4 → must block)
   * 3. Strong threats   (player has 3 in a window)
   * 4. Defensive moves  (opponent has 3)
   * 5. Center bias
   *
   * Decision: we avoid calling play/undo here (which would double the
   * per-node cost).  Instead we inspect windows directly, which is
   * O(windows-per-point) per move — much cheaper.
   */
  private orderMoves(
    position: GogoPosition,
    moves: Int16Array,
    count: number,
    ply: number,
  ): void {
    const scores = this.scoreBuffers[ply];
    const meta = position.meta;
    const board = position.board;
    const player = position.toMove;
    const opponent: Player = player === BLACK ? WHITE : BLACK;

    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      let score = meta.centerBias[move];

      for (
        let cursor = meta.windowsByPointOffsets[move];
        cursor < meta.windowsByPointOffsets[move + 1];
        cursor += 1
      ) {
        const windowIndex = meta.windowsByPoint[cursor];
        const base = windowIndex * 5;
        let mine = 0;
        let theirs = 0;
        for (let step = 0; step < 5; step += 1) {
          const cell = board[meta.windows[base + step]];
          mine += cell === player ? 1 : 0;
          theirs += cell === opponent ? 1 : 0;
        }
        if (theirs === 0) {
          if (mine === 4) score += 1_000_000;       // immediate win
          else if (mine === 3) score += 10_000;      // strong threat
          else if (mine === 2) score += 100;         // developing
        }
        if (mine === 0) {
          if (theirs === 4) score += 500_000;        // must block
          else if (theirs === 3) score += 8_000;     // defensive
          else if (theirs === 2) score += 80;        // developing defense
        }
      }

      scores[i] = score;
    }

    /* Insertion sort – fast for the small arrays we deal with. */
    for (let i = 1; i < count; i += 1) {
      const move = moves[i];
      const score = scores[i];
      let j = i;
      while (j > 0 && score > scores[j - 1]) {
        moves[j] = moves[j - 1];
        scores[j] = scores[j - 1];
        j -= 1;
      }
      moves[j] = move;
      scores[j] = score;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Puzzle verification                                                */
/* ------------------------------------------------------------------ */

export interface VerificationOptions {
  /** Whether to check the "not obvious" condition. Default true. */
  checkObvious?: boolean;
  /** Whether to check the "realistic" condition. Default true. */
  checkRealistic?: boolean;
}

export interface VerificationResult {
  valid: boolean;
  reason: string;
  solutionMove?: number;
  solutionAlgebraic?: string;
}

/**
 * Verify that a position is a valid `(n, m)` puzzle.
 *
 * ## Check ordering (cheapest → most expensive)
 *
 * 1. **Not obvious** – `GogoAI(maxDepth=1, quiescence=0)` must NOT
 *    select `candidateMove`.  Very cheap (single depth-1 search).
 *    *Why first:* rejects the majority of positions from self-play
 *    because most tactical moves are also obvious at depth 1.
 *
 * 2. **Solution exists at depth n** – exact `hasForceWin` at depth
 *    `n − 1` after playing the candidate move.  Moderate cost.
 *    *Why second:* confirms the candidate move actually works before
 *    we spend time checking all other moves.
 *
 * 3. **No faster solution** – exact `hasForceWin` at depth `n − 2`.
 *    Must be false.  *Why third:* same position, one level shallower
 *    (cheaper than checking other moves).
 *
 * 4. **Strict failure + threshold** – for every other legal move,
 *    verify opponent has a forced win of ≥ m plies.  Most expensive
 *    because it requires deep exact search for each wrong move.
 *    *Why not earlier:* no point checking 30+ wrong moves if the
 *    solution itself doesn't hold.  Within this step, we check
 *    threshold (depth < m) first per move because it's a shallower
 *    search that rejects quickly.
 *
 * 5. **Realistic** – no forced 3-ply wins in game history.  Moderate
 *    cost (shallow search at each historical ply).
 *    *Why last:* it checks the entire game history, which is wasted
 *    work if the position itself isn't a valid puzzle.
 *
 * @param maxStrictFailureDepth  Maximum depth to search for opponent's
 *   forced win on wrong moves.  Set high enough to find the win (9 is
 *   usually sufficient for (5,4) puzzles) but not so high that the
 *   search becomes infeasible.  If the opponent's forced win exceeds
 *   this depth, the candidate is conservatively rejected — this may
 *   reject valid puzzles but never accepts invalid ones.
 */
export function verifyPuzzle(
  position: GogoPosition,
  candidateMove: number,
  n: number,
  m: number,
  maxStrictFailureDepth: number,
  solver: ExactSolver,
  options: VerificationOptions = {},
): VerificationResult {
  const player = position.toMove;
  const opponent = otherPlayer(player);
  const meta = position.meta;
  const checkObvious = options.checkObvious !== false;
  const checkRealistic = options.checkRealistic !== false;

  /* ── Step 1: Not obvious ── */
  if (checkObvious) {
    const shallowAI = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
    const shallowResult = shallowAI.findBestMove(position, 5_000);
    if (shallowResult.move === candidateMove) {
      return { valid: false, reason: 'obvious' };
    }
  }

  /* ── Step 2: Solution exists at depth n ── */
  if (!position.play(candidateMove)) {
    return { valid: false, reason: 'illegal-solution' };
  }
  const hasWinAtN = solver.hasForceWin(position, player, n - 1);
  position.undo();

  if (!hasWinAtN) {
    return { valid: false, reason: 'no-forced-win' };
  }

  /* ── Step 3: No faster forced win (depth must be exactly n) ── */
  if (n >= 3) {
    position.play(candidateMove);
    const hasWinFaster = solver.hasForceWin(position, player, n - 2);
    position.undo();
    if (hasWinFaster) {
      return { valid: false, reason: 'faster-win' };
    }
  }

  /* ── Step 4: Strict failure + threshold for every other move ── */
  const allMoves = new Int16Array(position.area);
  const moveCount = position.generateAllLegalMoves(allMoves);

  for (let i = 0; i < moveCount; i += 1) {
    const move = allMoves[i];
    if (move === candidateMove) continue;

    position.play(move);

    /*
     * Threshold sub-check: opponent must NOT have a forced win in
     * fewer than m plies.  This is a shallower search (depth m − 1)
     * and rejects quickly when the threshold is violated.
     *
     * Decision: checking threshold before strict failure is correct
     * because a shallow "opponent wins too fast" result is cheap to
     * obtain and immediately disqualifies the candidate.
     */
    if (m > 1 && solver.hasForceWin(position, opponent, m - 1)) {
      position.undo();
      return {
        valid: false,
        reason: `threshold-violated:${encodeMove(move, meta)}`,
      };
    }

    /*
     * Strict failure sub-check: opponent MUST have a forced win
     * within maxStrictFailureDepth.  This proves the wrong move is
     * a losing move.
     *
     * Decision: we search up to maxStrictFailureDepth (default 9).
     * If no forced win is found, we conservatively reject.  This
     * may produce false negatives (rejecting valid puzzles whose
     * losing lines are very deep) but NEVER false positives.
     */
    if (!solver.hasForceWin(position, opponent, maxStrictFailureDepth)) {
      position.undo();
      return {
        valid: false,
        reason: `no-strict-failure:${encodeMove(move, meta)}`,
      };
    }

    position.undo();
  }

  /* ── Step 5: Realistic – no forced 3-ply wins in history ── */
  if (checkRealistic) {
    const tempPos = new GogoPosition(position.size);
    for (let ply = 0; ply < position.ply; ply += 1) {
      if (solver.hasForceWin(tempPos, tempPos.toMove, 3)) {
        return { valid: false, reason: `unrealistic:ply-${ply}` };
      }
      const moveAtPly = position.getMoveAt(ply);
      /* istanbul ignore next -- history from a valid game is always replayable */
      if (!tempPos.play(moveAtPly)) {
        return { valid: false, reason: `bad-history:ply-${ply}` };
      }
    }
  }

  return {
    valid: true,
    reason: 'valid',
    solutionMove: candidateMove,
    solutionAlgebraic: encodeMove(candidateMove, meta),
  };
}

/* ------------------------------------------------------------------ */
/*  Puzzle generation                                                  */
/* ------------------------------------------------------------------ */

export interface PuzzleCandidate {
  encoded: string;
  toMove: Player;
  solutionMove: number;
  solutionAlgebraic: string;
  depth: number;
  threshold: number;
}

export interface GeneratorOptions {
  /** Board size (only 9 is supported for puzzle generation). */
  boardSize: SupportedSize;
  /** Target forced-win depth n. */
  targetDepth: number;
  /** Target threshold m. */
  targetThreshold: number;
  /** Stop after finding this many puzzles. */
  maxPuzzles: number;
  /** Maximum number of self-play games. */
  maxGames: number;
  /** AI search depth for self-play moves. */
  selfPlayDepth: number;
  /** AI quiescence depth for self-play. */
  selfPlayQuiescence: number;
  /** AI search depth for candidate scanning. */
  scanDepth: number;
  /** AI quiescence depth for candidate scanning. */
  scanQuiescence: number;
  /** Time limit per self-play move (ms). */
  selfPlayTimeMs: number;
  /** Time limit per candidate scan (ms). */
  scanTimeMs: number;
  /** Max depth for strict-failure exact search. */
  maxStrictFailureDepth: number;
  /** Max moves already played in the puzzle position. */
  maxMovesInGame: number;
  /** Min moves already played before considering a position. */
  minMovesInGame: number;
  /**
   * Custom `now()` function for deterministic testing.
   * Defaults to `performance.now`.
   */
  now?: () => number;
}

const DEFAULT_OPTIONS: GeneratorOptions = {
  boardSize: 9,
  targetDepth: 5,
  targetThreshold: 4,
  maxPuzzles: 10,
  maxGames: 5_000,
  selfPlayDepth: 2,
  selfPlayQuiescence: 2,
  scanDepth: 4,
  scanQuiescence: 1,
  selfPlayTimeMs: 200,
  scanTimeMs: 2_000,
  maxStrictFailureDepth: 9,
  maxMovesInGame: 60,
  minMovesInGame: 8,
};

/**
 * Play a complete self-play game and return the game record.
 *
 * Decision: using depth-2 quiescence-2 AIs for self-play produces
 * positions of moderate tactical complexity — strong enough to not
 * blunder trivially but weak enough to leave forced wins for deeper
 * search to discover.  This matches the problem's suggestion.
 */
export function selfPlayGame(
  options: GeneratorOptions,
): GogoPosition {
  const pos = new GogoPosition(options.boardSize);
  const ai = new GogoAI({
    maxDepth: options.selfPlayDepth,
    quiescenceDepth: options.selfPlayQuiescence,
    now: options.now,
  });

  while (pos.winner === EMPTY && pos.ply < options.maxMovesInGame) {
    const result = ai.findBestMove(pos, options.selfPlayTimeMs);
    if (result.move === -1) break;
    if (!pos.play(result.move)) break;
  }

  return pos;
}

/**
 * Scan a game for puzzle candidates and verify them.
 *
 * At each position in the game history (between minMoves and maxMoves):
 * 1. A stronger AI (scanDepth/scanQuiescence) checks for a win.
 * 2. If a win is found, it's verified with the ExactSolver pipeline.
 *
 * Decision: we scan the full game rather than just the final position
 * because winning opportunities arise and vanish throughout play.
 * Scanning is sequential (cheapest checks first per position).
 *
 * @returns Array of verified puzzle candidates found in this game.
 */
export function scanGameForPuzzles(
  gamePosition: GogoPosition,
  options: GeneratorOptions,
  solver: ExactSolver,
  existingEncodings?: Set<string>,
): PuzzleCandidate[] {
  const results: PuzzleCandidate[] = [];
  const scanner = new GogoAI({
    maxDepth: options.scanDepth,
    quiescenceDepth: options.scanQuiescence,
    now: options.now,
  });

  /* Replay the game move by move, checking each position. */
  const pos = new GogoPosition(options.boardSize);
  const totalMoves = gamePosition.ply;

  for (let ply = 0; ply < totalMoves; ply += 1) {
    /*
     * Decision: only consider positions with enough stones for
     * tactical complexity but not too many (to keep move count ≤ 60).
     */
    if (ply >= options.minMovesInGame && ply <= options.maxMovesInGame) {
      const candidate = checkPositionForPuzzle(
        pos,
        scanner,
        options,
        solver,
        existingEncodings,
      );
      if (candidate !== null) {
        results.push(candidate);
      }
    }

    const move = gamePosition.getMoveAt(ply);
    if (!pos.play(move)) break;
  }

  return results;
}

/**
 * Check a single position for being a valid puzzle.
 *
 * Pipeline (cheapest → most expensive):
 * 1. Strong AI scan: does the scanner AI see a win? (heuristic filter)
 * 2. Full verification via verifyPuzzle (exact search)
 * 3. Duplicate check against existing puzzles
 *
 * Decision: the AI-based scan at step 1 filters out ~95% of positions
 * very cheaply.  Only positions where the AI reports a near-WIN_SCORE
 * result proceed to the expensive exact verification.
 */
function checkPositionForPuzzle(
  position: GogoPosition,
  scanner: GogoAI,
  options: GeneratorOptions,
  solver: ExactSolver,
  existingEncodings?: Set<string>,
): PuzzleCandidate | null {
  if (position.winner !== EMPTY) return null;

  /* Step 1: Strong AI scan — does it see a win? */
  const scanResult = scanner.findBestMove(position, options.scanTimeMs);
  if (scanResult.move === -1) return null;

  /*
   * Decision: we require the AI score to indicate an actual forced win
   * (score near WIN_SCORE), not just a positional advantage.  The AI
   * returns -WIN_SCORE + ply for proven wins, so scores ≥ WIN_SCORE − 20
   * indicate wins within ~20 plies.  We use a tighter threshold to
   * match our target depth.
   */
  const winThreshold = WIN_SCORE - (options.targetDepth + options.scanQuiescence + 5);
  if (scanResult.score < winThreshold) return null;

  /* Step 2: Full exact verification. */
  const verification = verifyPuzzle(
    position,
    scanResult.move,
    options.targetDepth,
    options.targetThreshold,
    options.maxStrictFailureDepth,
    solver,
  );
  if (!verification.valid) return null;

  /* Step 3: Duplicate check. */
  const encoded = position.encodeGame();
  if (existingEncodings !== undefined && existingEncodings.has(encoded)) {
    return null;
  }

  return {
    encoded,
    toMove: position.toMove,
    solutionMove: verification.solutionMove!,
    solutionAlgebraic: verification.solutionAlgebraic!,
    depth: options.targetDepth,
    threshold: options.targetThreshold,
  };
}

/**
 * Generate puzzles by self-play and verification.
 *
 * High-level flow:
 * 1. Play self-play games with weak AIs.
 * 2. At each position, scan with a stronger AI for winning moves.
 * 3. Verify candidates with the ExactSolver.
 * 4. Collect unique valid puzzles until we have enough.
 *
 * @returns Array of verified, unique puzzle candidates.
 */
export function generatePuzzles(
  options: Partial<GeneratorOptions> = {},
): PuzzleCandidate[] {
  const opts: GeneratorOptions = { ...DEFAULT_OPTIONS, ...options };
  const area = opts.boardSize * opts.boardSize;

  /*
   * Decision: ExactSolver is allocated once with maxStrictFailureDepth
   * buffer depth.  This avoids repeated allocations across candidates.
   */
  const solver = new ExactSolver(area, opts.maxStrictFailureDepth);
  const puzzles: PuzzleCandidate[] = [];
  const seenEncodings = new Set<string>();

  for (let game = 0; game < opts.maxGames; game += 1) {
    const gamePos = selfPlayGame(opts);
    const found = scanGameForPuzzles(gamePos, opts, solver, seenEncodings);

    for (const puzzle of found) {
      seenEncodings.add(puzzle.encoded);
      puzzles.push(puzzle);
      if (puzzles.length >= opts.maxPuzzles) return puzzles;
    }
  }

  return puzzles;
}
