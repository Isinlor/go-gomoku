import { BLACK, EMPTY, GogoPosition, otherPlayer, type Cell, type Player, WHITE } from './gogomoku';
import { insertMoveDescending } from './moveOrdering';

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  timedOut: boolean;
  /** True only when an exact (proof) search has confirmed a forced win. */
  forcedWin: boolean;
  /** True only when an exact (proof) search has confirmed a forced loss. */
  forcedLoss: boolean;
  /** True when the heuristic search (with NMP/LMR) suggests a forced win. */
  heuristicWin: boolean;
  /** True when the heuristic search (with NMP/LMR) suggests a forced loss. */
  heuristicLoss: boolean;
}

export interface GogoAIOptions {
  maxDepth?: number;
  quiescenceDepth?: number;
  maxPly?: number;
  now?: () => number;
}

interface SearchState {
  bestMove: number;
  bestScore: number;
  completedDepth: number;
  hintMove: number;
}

const WIN_SCORE = 1_000_000_000;
const ATTACK_WEIGHTS = [0, 12, 72, 540, 100_000, 500_000] as const;
const DEFENSE_WEIGHTS = [0, 16, 96, 720, 100_000, 500_000] as const;
const EVAL_WEIGHTS = [0, 6, 32, 240, 500_000, WIN_SCORE >> 2] as const;
const LOCAL_LIBERTY_WEIGHTS = [-200, -80, 20, 60, 80] as const;
const TACTICAL_PATTERN_THRESHOLD = ATTACK_WEIGHTS[4];
const CENTER_MULTIPLIER = 3;
const HINT_BONUS = 10_000_000;
const HISTORY_SCALE = 1;
const KILLER_BONUS = 1_000_000;
const CAPTURE_BONUS = 5_000;
const ESCAPE_BONUS = 3_500;
const NO_SCORE = Number.NEGATIVE_INFINITY;
const MAX_CANDIDATES = 12;

// Transposition table constants
const TT_SIZE_BITS = 18;
const TT_SIZE = 1 << TT_SIZE_BITS;
const TT_MASK = BigInt(TT_SIZE - 1);
const TT_NONE = 0;
const TT_EXACT = 1;
const TT_LOWERBOUND = 2;
const TT_UPPERBOUND = 3;

export class GogoAI {
  readonly maxDepth: number;
  readonly quiescenceDepth: number;
  readonly maxPly: number;

  private readonly now: () => number;
  private moveBuffers: Int16Array[] = [];
  private scoreBuffers: Int32Array[] = [];
  private history = new Int32Array(0);
  private candidateMarks = new Uint32Array(0);
  private candidateEpoch = 1;
  private triedMoveMarks = new Uint32Array(0);
  private triedMoveEpoch = 1;
  private scorerGroupMarks = new Uint32Array(0);
  private scorerGroupEpoch = 1;
  private scoredGroupEpoch = new Uint32Array(0);
  private scoredGroupLiberties = new Uint8Array(0);
  private scoredGroupSizes = new Uint8Array(0);
  private scoredGroupRoots = new Int16Array(0);
  private scoredGroupPassEpoch = 1;
  private scoredGroupHash = -1n;
  private bufferArea = 0;
  private deadline = 0;
  private nodesVisited = 0;
  private timedOut = false;
  private killerMoves = new Int16Array(0);
  private readonly timeoutSignal = new Error('SEARCH_TIMEOUT');
  private proofMode = false;

  // Transposition table
  private ttHash = new BigUint64Array(TT_SIZE);
  private ttScore = new Int32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Uint8Array(TT_SIZE);
  private ttBestMove = new Int16Array(TT_SIZE);

  constructor(options: GogoAIOptions = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 6);
    this.quiescenceDepth = Math.max(0, options.quiescenceDepth ?? 6);
    this.maxPly = Math.max(2, options.maxPly ?? 64);
    this.now = options.now ?? (() => performance.now());
  }

  findBestMove(position: GogoPosition, timeLimitMs: number): SearchResult {
    this.ensureBuffers(position.area);
    this.resetSearchHeuristics();
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;
    this.proofMode = false;

    if (position.winner !== EMPTY) {
      return {
        move: -1,
        score: -WIN_SCORE,
        depth: 0,
        nodes: 0,
        timedOut: false,
        forcedWin: false,
        forcedLoss: true,
        heuristicWin: false,
        heuristicLoss: true,
      };
    }

    const state: SearchState = {
      bestMove: this.pickFallbackMove(position),
      bestScore: 0,
      completedDepth: 0,
      hintMove: -1,
    };
    const fallbackMove = state.bestMove;
    if (fallbackMove === -1 || this.now() >= this.deadline) {
      return {
        move: fallbackMove,
        score: 0,
        depth: 0,
        nodes: 0,
        timedOut: fallbackMove !== -1,
        forcedWin: false,
        forcedLoss: false,
        heuristicWin: false,
        heuristicLoss: false,
      };
    }

    state.hintMove = fallbackMove;
    // === Phase 1: Heuristic Discovery ===
    // Use NMP, LMR, and candidate capping for fast search.
    this.searchDepths(position, 1, state);

    const heuristicWin = this.isForcedWinScore(state.bestScore, state.completedDepth);
    const heuristicLoss = this.isForcedLossScore(state.bestScore, state.completedDepth);
    let provenWin = false;
    let provenLoss = false;

    // === Phase 2: Proof ===
    // When the heuristic search found a forced outcome, verify with exact search.
    // For wins: use AND/OR threat-space prover (fast for tactical wins).
    // For losses: use full exact root negamax (proofSearchRoot).
    if ((heuristicWin || heuristicLoss) && this.now() < this.deadline) {
      let proofFailed = false;

      if (heuristicWin) {
        // AND/OR threat-space prover for forced wins
        const remainingMs = this.deadline - this.now();
        if (this.verifyWinningMove(position, state.bestMove, remainingMs)) {
          provenWin = true;
        } else if (!this.timedOut) {
          proofFailed = true;
        }
      } else {
        // Full exact root search for forced losses
        this.proofMode = true;
        this.resetSearchHeuristics(true);

        for (let proofDepth = 1; proofDepth <= state.completedDepth; proofDepth += 1) {
          try {
            const proofResult = this.proofSearchRoot(position, proofDepth, state.bestMove);
            if (proofDepth === state.completedDepth) {
              if (this.isForcedLossScore(proofResult, proofDepth)) {
                provenLoss = true;
              } else {
                proofFailed = true;
              }
            }
          } catch (error) {
            if (error !== this.timeoutSignal) {
              throw error;
            }
            this.timedOut = true;
            break;
          }
        }
        this.proofMode = false;
      }

      // === Phase 3: Resume heuristic if proof collapsed ===
      // The heuristic claimed a forced outcome but exact search disagrees.
      // Continue heuristic discovery at deeper depths with remaining time.
      if (proofFailed && this.now() < this.deadline) {
        this.timedOut = false;
        this.resetSearchHeuristics(true);
        this.searchDepths(position, state.completedDepth + 1, state);
      }
    }

    // Recompute heuristic flags in case resume changed bestScore/completedDepth
    const finalHeuristicWin = this.isForcedWinScore(state.bestScore, state.completedDepth);
    const finalHeuristicLoss = this.isForcedLossScore(state.bestScore, state.completedDepth);

    return {
      move: state.bestMove,
      score: state.bestScore,
      depth: state.completedDepth,
      nodes: this.nodesVisited,
      timedOut: this.timedOut,
      forcedWin: provenWin,
      forcedLoss: provenLoss,
      heuristicWin: finalHeuristicWin,
      heuristicLoss: finalHeuristicLoss,
    };
  }

  private ensureBuffers(area: number): void {
    if (this.bufferArea === area) {
      return;
    }
    this.bufferArea = area;
    this.moveBuffers = new Array(this.maxPly + 1);
    this.scoreBuffers = new Array(this.maxPly + 1);
    for (let ply = 0; ply <= this.maxPly; ply += 1) {
      this.moveBuffers[ply] = new Int16Array(area);
      this.scoreBuffers[ply] = new Int32Array(area);
    }
    this.history = new Int32Array(area * 2);
    this.candidateMarks = new Uint32Array(area);
    this.candidateEpoch = 1;
    this.triedMoveMarks = new Uint32Array(area);
    this.triedMoveEpoch = 1;
    this.scorerGroupMarks = new Uint32Array(area);
    this.scorerGroupEpoch = 1;
    this.scoredGroupEpoch = new Uint32Array(area);
    this.scoredGroupLiberties = new Uint8Array(area);
    this.scoredGroupSizes = new Uint8Array(area);
    this.scoredGroupRoots = new Int16Array(area);
    this.scoredGroupRoots.fill(-1);
    this.scoredGroupPassEpoch = 1;
    this.scoredGroupHash = -1n;
    this.killerMoves = new Int16Array((this.maxPly + 1) * 2);
    this.killerMoves.fill(-1);
  }

  private resetSearchHeuristics(clearTT = false): void {
    this.history.fill(0);
    this.killerMoves.fill(-1);
    if (clearTT) this.ttFlag.fill(0);
  }

  private searchDepths(position: GogoPosition, startDepth: number, state: SearchState): void {
    for (let depth = startDepth; depth <= this.maxDepth; depth += 1) {
      try {
        const result = this.searchRoot(position, depth, state.hintMove);
        if (result.move === -1) {
          continue;
        }
        state.bestMove = result.move;
        state.bestScore = result.score;
        state.completedDepth = depth;
        state.hintMove = result.move;
        if (this.isForcedWinScore(result.score, depth) || this.isForcedLossScore(result.score, depth)) {
          break;
        }
      } catch (error) {
        if (error !== this.timeoutSignal) {
          throw error;
        }
        this.timedOut = true;
        break;
      }
    }
  }

  private isForcedWinScore(score: number, depth: number): boolean {
    return score >= WIN_SCORE - depth;
  }

  private isForcedLossScore(score: number, depth: number): boolean {
    return score <= -WIN_SCORE + depth;
  }

  private pickFallbackMove(position: GogoPosition): number {
    if (position.stoneCount === 0) {
      return ((position.size >> 1) * position.size) + (position.size >> 1);
    }

    const moves = this.moveBuffers[0];
    const scores = this.scoreBuffers[0];
    let count = this.generateOrderedMoves(position, moves, scores, -1, false);
    for (let i = 0; i < count; i += 1) {
      if (position.play(moves[i])) {
        position.undo();
        return moves[i];
      }
    }

    count = this.generateFullBoardMoves(position, moves, scores, -1, false);
    for (let i = 0; i < count; i += 1) {
      if (position.play(moves[i])) {
        position.undo();
        return moves[i];
      }
    }

    return -1;
  }

  /**
   * Full exact root search for forced-loss proof (proof mode).
   * Searches ALL root moves to verify that every defense leads to a loss.
   * Returns the best score achievable from the root.
   */
  private proofSearchRoot(position: GogoPosition, depth: number, hintMove: number): number {
    const result = this.searchRoot(position, depth, hintMove);
    return result.move === -1 ? 0 : result.score;
  }

  private searchRoot(position: GogoPosition, depth: number, hintMove: number): SearchResult {
    this.checkTime(true);
    const beta = WIN_SCORE;
    const moves = this.moveBuffers[0];
    const scores = this.scoreBuffers[0];

    let count = this.generateOrderedMoves(position, moves, scores, hintMove, false);
    let alpha = -WIN_SCORE;
    let bestMove = -1;
    let bestScore = -WIN_SCORE;
    let legalCount = 0;
    let usedFullBoard = false;

    for (;;) {
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (!position.play(move)) {
          continue;
        }
        legalCount += 1;
        let score = 0;
        try {
          score = -this.search(position, depth - 1, -beta, -alpha, 1);
        } finally {
          position.undo();
        }
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score > alpha) {
          alpha = score;
        }
      }
      if (legalCount !== 0 || usedFullBoard) {
        return {
          move: legalCount === 0 ? -1 : bestMove,
          score: legalCount === 0 ? 0 : bestScore,
          depth,
          nodes: this.nodesVisited,
          timedOut: false,
          forcedWin: false,
          forcedLoss: false,
          heuristicWin: false,
          heuristicLoss: false,
        };
      }
      count = this.generateFullBoardMoves(position, moves, scores, hintMove, false);
      usedFullBoard = true;
    }
  }

  private search(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, canNullMove = true): number {
    this.checkTime(false);
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }
    if (depth <= 0 || ply >= this.maxPly) {
      return this.quiescence(position, alpha, beta, ply, this.quiescenceDepth);
    }

    const origAlpha = alpha;

    // Transposition table probe
    const hash = position.hash;
    const ttIndex = Number(hash & TT_MASK);
    let ttBest = -1;
    // Always extract bestMove hint for ordering (even when flags are cleared)
    if (this.ttHash[ttIndex] === hash) {
      ttBest = this.ttBestMove[ttIndex];
    }
    // Score cutoffs require a valid flag entry at sufficient depth
    if (this.ttHash[ttIndex] === hash && this.ttFlag[ttIndex] !== TT_NONE && this.ttDepth[ttIndex] >= depth) {
      const ttFlag = this.ttFlag[ttIndex];
      const ttScore = this.ttAdjustRetrieve(this.ttScore[ttIndex], ply);
      if (ttFlag === TT_EXACT) return ttScore;
      if (ttFlag === TT_LOWERBOUND && ttScore >= beta) return ttScore;
      if (ttFlag === TT_UPPERBOUND && ttScore <= alpha) return ttScore;
    }

    // Null move pruning: if we give the opponent a free move and they still
    // can't beat beta, the position is likely good enough to prune.
    // Skipped in proof mode because NMP is unsound (can miss forced wins).
    if (depth >= 3 && canNullMove && !this.proofMode) {
      const R = depth >= 6 ? 3 : 2;
      const savedToMove = position.toMove;
      const savedKo = position.koPoint;
      const savedHash = position.hash;
      position.toMove = otherPlayer(savedToMove);
      position.koPoint = -1;
      // Update hash: toggle side-to-move + change ko from savedKo to -1
      const oldKoIdx = savedKo === -1 ? position.area : savedKo;
      const noKoIdx = position.area;
      position.hash ^= position.meta.zobristBlackToMove64 ^ position.meta.zobristKo64[oldKoIdx] ^ position.meta.zobristKo64[noKoIdx];
      let nullScore: number;
      try {
        nullScore = -this.search(position, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      } finally {
        position.toMove = savedToMove;
        position.koPoint = savedKo;
        position.hash = savedHash;
      }
      if (nullScore >= beta) {
        return beta;
      }
    }

    const hintMove = ttBest !== -1 ? ttBest : -1;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = this.generateOrderedMoves(position, moves, scores, hintMove, false, ply);
    let wasCapped = false;
    if (!this.proofMode && count > MAX_CANDIDATES) {
      count = MAX_CANDIDATES;
      wasCapped = true;
    }
    let usedFullBoard = false;
    let legalCount = 0;
    let bestScore = -WIN_SCORE;
    let bestMove = -1;

    for (;;) {
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (!position.play(move)) {
          continue;
        }
        legalCount += 1;
        let score = 0;
        try {
          if (legalCount === 1) {
            // PVS: full window for the first (best-ordered) move
            score = -this.search(position, depth - 1, -beta, -alpha, ply + 1);
          } else {
            // LMR: reduce search depth for later moves.
            // Skipped in proof mode because LMR is unsound.
            let searchDepth = depth - 1;
            if (!this.proofMode && depth >= 3 && legalCount > 3) {
              searchDepth = Math.max(1, searchDepth - 1);
            }
            // PVS: zero-window scout search (possibly reduced)
            score = -this.search(position, searchDepth, -alpha - 1, -alpha, ply + 1);
            // If LMR was applied and scout found improvement, re-search at full depth
            if (searchDepth < depth - 1 && score > alpha) {
              score = -this.search(position, depth - 1, -alpha - 1, -alpha, ply + 1);
            }
            if (score > alpha && score < beta) {
              // Re-search with full window if scout indicates a better move
              score = -this.search(position, depth - 1, -beta, -alpha, ply + 1);
            }
          }
        } finally {
          position.undo();
        }
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.history[(position.toMove - 1) * this.bufferArea + move] += depth * depth * HISTORY_SCALE;
            // Update killer moves for this ply
            if (this.killerMoves[ply * 2] !== move) {
              this.killerMoves[ply * 2 + 1] = this.killerMoves[ply * 2];
              this.killerMoves[ply * 2] = move;
            }
            break;
          }
        }
      }
      if (legalCount !== 0 || usedFullBoard) {
        break;
      }
      count = this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply);
      if (!this.proofMode && count > MAX_CANDIDATES) {
        count = MAX_CANDIDATES;
        wasCapped = true;
      }
      usedFullBoard = true;
    }

    if (legalCount === 0) {
      return 0;
    }

    // Transposition table store
    // Capped nodes (MAX_CANDIDATES applied) may have missed legal defenses.
    // Only TT_LOWERBOUND (fail-high on a real move) is safe from capped nodes.
    // TT_EXACT and TT_UPPERBOUND may be wrong because unsearched moves could
    // have produced a higher score.
    const storeFlag = bestScore <= origAlpha ? TT_UPPERBOUND
                    : alpha >= beta ? TT_LOWERBOUND
                    : TT_EXACT;
    if (!wasCapped || storeFlag === TT_LOWERBOUND) {
      this.ttHash[ttIndex] = hash;
      this.ttScore[ttIndex] = this.ttAdjustStore(bestScore, ply);
      this.ttDepth[ttIndex] = depth;
      this.ttFlag[ttIndex] = storeFlag;
      this.ttBestMove[ttIndex] = bestMove;
    } else {
      // Still store best move for ordering even if we don't store the score
      this.ttHash[ttIndex] = hash;
      this.ttBestMove[ttIndex] = bestMove;
      this.ttFlag[ttIndex] = TT_NONE;
    }

    return bestScore;
  }

  private quiescence(position: GogoPosition, alpha: number, beta: number, ply: number, remainingDepth: number): number {
    this.checkTime(false);
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }

    const standPat = this.evaluate(position);
    if (standPat >= beta) {
      return standPat;
    }
    if (standPat > alpha) {
      alpha = standPat;
    }
    if (remainingDepth === 0 || ply >= this.maxPly) {
      return standPat;
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    const count = this.generateOrderedMoves(position, moves, scores, -1, true);
    if (count === 0) {
      return standPat;
    }

    let bestScore = standPat;
    let legalCount = 0;
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      if (!position.play(move)) {
        continue;
      }
      legalCount += 1;
      let score = 0;
      try {
        score = -this.quiescence(position, -beta, -alpha, ply + 1, remainingDepth - 1);
      } finally {
        position.undo();
      }
      if (score > bestScore) {
        bestScore = score;
      }
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          return score;
        }
      }
    }

    return legalCount === 0 ? standPat : bestScore;
  }

  private evaluate(position: GogoPosition): number {
    let score = 0;
    const board = position.board;
    const meta = position.meta;
    const windows = meta.windows;

    for (let windowIndex = 0; windowIndex < meta.windowCount; windowIndex += 1) {
      const base = windowIndex * 5;
      const c0 = board[windows[base]];
      const c1 = board[windows[base + 1]];
      const c2 = board[windows[base + 2]];
      const c3 = board[windows[base + 3]];
      const c4 = board[windows[base + 4]];
      // Branchless counting: EMPTY=0, BLACK=1 (bit 0), WHITE=2 (bit 1)
      const black = (c0 & 1) + (c1 & 1) + (c2 & 1) + (c3 & 1) + (c4 & 1);
      const white = (c0 >> 1) + (c1 >> 1) + (c2 >> 1) + (c3 >> 1) + (c4 >> 1);
      if (black === 0 && white !== 0) {
        score -= EVAL_WEIGHTS[white];
      } else if (white === 0 && black !== 0) {
        score += EVAL_WEIGHTS[black];
      }
    }

    const neighbors = meta.neighbors4;
    for (let point = 0; point < position.area; point += 1) {
      const cell = board[point];
      if (cell === EMPTY) {
        continue;
      }
      let localLiberties = 0;
      const neighborBase = point * 4;
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = neighbors[neighborBase + offset];
        localLiberties += neighbor !== -1 && board[neighbor] === EMPTY ? 1 : 0;
      }
      const libertyBucket = Math.min(localLiberties, LOCAL_LIBERTY_WEIGHTS.length - 1);
      const stoneScore = meta.centerBias[point] * CENTER_MULTIPLIER + LOCAL_LIBERTY_WEIGHTS[libertyBucket];
      score += cell === BLACK ? stoneScore : -stoneScore;
    }

    return position.toMove === BLACK ? score : -score;
  }

  private generateOrderedMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Int32Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply = 0,
  ): number {
    if (position.winner !== EMPTY) {
      return 0;
    }
    if (position.stoneCount === 0) {
      if (tacticalOnly) {
        return 0;
      }
      const center = ((position.size >> 1) * position.size) + (position.size >> 1);
      moves[0] = center;
      scores[0] = 0;
      return 1;
    }

    const board = position.board;
    const meta = position.meta;
    const near2 = meta.near2;
    const near2Offsets = meta.near2Offsets;
    this.candidateEpoch += 1;
    this.beginScoredGroupPass(position);
    let count = 0;

    for (let point = 0; point < position.area; point += 1) {
      if (board[point] === EMPTY) {
        continue;
      }
      for (let cursor = near2Offsets[point]; cursor < near2Offsets[point + 1]; cursor += 1) {
        const move = near2[cursor];
        if (board[move] !== EMPTY || move === position.koPoint || this.candidateMarks[move] === this.candidateEpoch) {
          continue;
        }
        const score = this.scoreMove(position, move, hintMove, tacticalOnly, ply);
        if (score === NO_SCORE) {
          continue;
        }
        this.candidateMarks[move] = this.candidateEpoch;
        insertMoveDescending(moves, scores, count, move, score);
        count += 1;
      }
    }

    return count;
  }

  private generateFullBoardMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Int32Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply = 0,
  ): number {
    this.beginScoredGroupPass(position);
    let count = 0;
    for (let move = 0; move < position.area; move += 1) {
      if (position.board[move] !== EMPTY || move === position.koPoint) {
        continue;
      }
      const score = this.scoreMove(position, move, hintMove, tacticalOnly, ply);
      if (score === NO_SCORE) {
        continue;
      }
      insertMoveDescending(moves, scores, count, move, score);
      count += 1;
    }
    return count;
  }

  private beginScoredGroupPass(position: GogoPosition): void {
    if (this.scoredGroupHash === position.hash) {
      return;
    }
    this.scoredGroupPassEpoch += 1;
    this.scoredGroupHash = position.hash;
  }

  private getScoredGroupInfo(position: GogoPosition, point: number, color: Player): { liberties: number; size: number; root: number } {
    this.beginScoredGroupPass(position);
    if (this.scoredGroupEpoch[point] !== this.scoredGroupPassEpoch) {
      const liberties = position.scanGroup(point, color);
      const size = position.scanGroupSize;
      const root = position.groupBuffer[0];
      for (let i = 0; i < size; i += 1) {
        const stone = position.groupBuffer[i];
        this.scoredGroupEpoch[stone] = this.scoredGroupPassEpoch;
        this.scoredGroupLiberties[stone] = liberties;
        this.scoredGroupSizes[stone] = size;
        this.scoredGroupRoots[stone] = root;
      }
    }

    return {
      liberties: this.scoredGroupLiberties[point],
      size: this.scoredGroupSizes[point],
      root: this.scoredGroupRoots[point],
    };
  }

  private scoreMove(position: GogoPosition, move: number, hintMove: number, tacticalOnly: boolean, ply = 0): number {
    const player = position.toMove;
    const opponent = otherPlayer(player);
    const playerShift = player - 1;
    const opponentShift = 2 - player;
    const meta = position.meta;
    const windowsByPoint = meta.windowsByPoint;
    const windowOffsets = meta.windowsByPointOffsets;
    const windows = meta.windows;
    const board = position.board;

    let attack = 0;
    let defense = 0;
    for (let cursor = windowOffsets[move]; cursor < windowOffsets[move + 1]; cursor += 1) {
      const windowIndex = windowsByPoint[cursor];
      const base = windowIndex * 5;
      const c0 = board[windows[base]];
      const c1 = board[windows[base + 1]];
      const c2 = board[windows[base + 2]];
      const c3 = board[windows[base + 3]];
      const c4 = board[windows[base + 4]];
      // Branchless counting: playerShift/opponentShift map BLACK(1)→bit0, WHITE(2)→bit1
      const mine = ((c0 >> playerShift) & 1) + ((c1 >> playerShift) & 1) + ((c2 >> playerShift) & 1) + ((c3 >> playerShift) & 1) + ((c4 >> playerShift) & 1);
      const theirs = ((c0 >> opponentShift) & 1) + ((c1 >> opponentShift) & 1) + ((c2 >> opponentShift) & 1) + ((c3 >> opponentShift) & 1) + ((c4 >> opponentShift) & 1);
      if (theirs === 0) {
        attack += ATTACK_WEIGHTS[mine + 1];
      }
      if (mine === 0) {
        defense += DEFENSE_WEIGHTS[theirs + 1];
      }
    }

    let capturePressure = 0;
    let escapePressure = 0;
    const neighbors = meta.neighbors4;
    const neighborBase = move * 4;
    this.scorerGroupEpoch += 1;
    for (let offset = 0; offset < 4; offset += 1) {
      const neighbor = neighbors[neighborBase + offset];
      if (neighbor === -1) {
        continue;
      }
      const cell = board[neighbor];
      if (cell === opponent) {
        const { liberties, size, root } = this.getScoredGroupInfo(position, neighbor, opponent);
        if (this.scorerGroupMarks[root] === this.scorerGroupEpoch) {
          continue;
        }
        this.scorerGroupMarks[root] = this.scorerGroupEpoch;
        if (liberties === 1) {
          capturePressure += CAPTURE_BONUS + (size * 300);
        } else if (liberties === 2) {
          capturePressure += size * 30;
        }
      } else if (cell === player) {
        const { liberties, size, root } = this.getScoredGroupInfo(position, neighbor, player);
        if (this.scorerGroupMarks[root] === this.scorerGroupEpoch) {
          continue;
        }
        this.scorerGroupMarks[root] = this.scorerGroupEpoch;
        if (liberties === 1) {
          escapePressure += ESCAPE_BONUS + (size * 250);
        } else if (liberties === 2) {
          escapePressure += size * 20;
        }
      }
    }

    if (
      tacticalOnly &&
      attack < TACTICAL_PATTERN_THRESHOLD &&
      defense < DEFENSE_WEIGHTS[4] &&
      capturePressure === 0 &&
      escapePressure === 0
    ) {
      return NO_SCORE;
    }

    let score = attack + defense + capturePressure + escapePressure;
    score += meta.centerBias[move] * CENTER_MULTIPLIER;
    score += this.history[(player - 1) * this.bufferArea + move];
    if (move === hintMove) {
      score += HINT_BONUS;
    }
    if (move === this.killerMoves[ply * 2] || move === this.killerMoves[ply * 2 + 1]) {
      score += KILLER_BONUS;
    }
    return score;
  }

  private insertOrPromoteMove(moves: Int16Array, scores: Int32Array, count: number, move: number, score: number): number {
    if (this.candidateMarks[move] !== this.candidateEpoch) {
      this.candidateMarks[move] = this.candidateEpoch;
      insertMoveDescending(moves, scores, count, move, score);
      return count + 1;
    }

    for (let index = 0; index < count; index += 1) {
      if (moves[index] !== move) continue;
      if (score <= scores[index]) return count;
      while (index > 0 && score > scores[index - 1]) {
        moves[index] = moves[index - 1];
        scores[index] = scores[index - 1];
        index -= 1;
      }
      moves[index] = move;
      scores[index] = score;
      return count;
    }

    // Defensive fallback: a stale mark may remain even when the move is absent
    // from the current buffer (for example in white-box tests that seed marks
    // directly). Treat it as already known and leave the ordering unchanged.
    return count;
  }

  private checkTime(force: boolean): void {
    this.nodesVisited += 1;
    if ((force || (this.nodesVisited & 127) === 0) && this.now() >= this.deadline) {
      throw this.timeoutSignal;
    }
  }

  private ttAdjustStore(score: number, ply: number): number {
    if (score >= WIN_SCORE - this.maxPly) return score + ply;
    if (score <= -WIN_SCORE + this.maxPly) return score - ply;
    return score;
  }

  private ttAdjustRetrieve(score: number, ply: number): number {
    if (score >= WIN_SCORE - this.maxPly) return score - ply;
    if (score <= -WIN_SCORE + this.maxPly) return score + ply;
    return score;
  }

  // === AND/OR Threat-Space Prover ===
  // Dedicated prover for forced-win verification using attacker/defender recursion.
  // Attacker generates only forcing threats; defender generates all legal refutations.
  // This is much faster than full negamax for proving tactical wins.
  private proofTTHash = new BigUint64Array(TT_SIZE);
  // 1 = proven win, -1 = proven loss, 0 = unknown
  private proofTTResult = new Int8Array(TT_SIZE);
  private proofTTDepth = new Int8Array(TT_SIZE);
  private proofTTBestMove = new Int16Array(TT_SIZE);

  private resetProofSearch(): void {
    // Reset proof TT and search heuristics so the main iterative-deepening
    // heuristic phase does not leak move-ordering state (history/killers) into
    // proof search, which can amplify TT collision patterns and make proofs incomplete.
    this.resetSearchHeuristics();
    this.proofTTHash.fill(0n);
    this.proofTTResult.fill(0);
    this.proofTTDepth.fill(0);
    this.proofTTBestMove.fill(-1);
  }

  private storeProofTT(ttIdx: number, hash: bigint, depthLeft: number, result: 1 | -1, bestMove?: number): void {
    this.proofTTHash[ttIdx] = hash;
    this.proofTTResult[ttIdx] = result;
    this.proofTTDepth[ttIdx] = depthLeft;
    this.proofTTBestMove[ttIdx] = bestMove ?? -1;
  }

  /**
   * Verify that playing `move` leads to a forced win for the current side.
   * Uses AND/OR threat-space search with a dedicated proof TT.
   * Returns true if the win is provable within the time and depth limits.
   */
  verifyWinningMove(position: GogoPosition, move: number, timeLimitMs: number): boolean {
    this.ensureBuffers(position.area);
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;
    this.resetProofSearch();

    if (!position.play(move)) return false;
    try {
      // Iterative deepening: start shallow and deepen. Earlier iterations
      // populate the proof TT, which acts as a powerful pruning mechanism
      // for deeper iterations.
      for (let maxDepth = 1; maxDepth <= this.maxPly; maxDepth += 2) {
        try {
          const result = this.proofDefend(position, maxDepth, 1);
          if (result) return true;
        } catch (error) {
          if (error !== this.timeoutSignal) {
            throw error;
          }
          this.timedOut = true;
          return false;
        }
      }
      return false;
    } finally {
      position.undo();
    }
  }

  /**
   * Attacker (OR node): try to find at least one forcing move that wins.
   * Generates only tactical/forcing moves. If any wins, return true.
   */
  private proofAttack(position: GogoPosition, depthLeft: number, ply: number): boolean {
    this.checkTime(false);

    // If there's a winner, it must be the opponent (the one who just played)
    // since we're the attacker looking to move. This means we lost.
    if (position.winner !== EMPTY) return false;
    if (depthLeft <= 0) return false;

    // Proof TT probe
    const hash = position.hash;
    const ttIdx = Number(hash & TT_MASK);
    let ttBest = -1;
    if (this.proofTTHash[ttIdx] === hash) {
      if (this.proofTTDepth[ttIdx] >= depthLeft) {
        if (this.proofTTResult[ttIdx] === 1) return true;
        if (this.proofTTResult[ttIdx] === -1) return false;
      }
      ttBest = this.proofTTBestMove[ttIdx];
    }

    // Hash move first: try the TT best move before generating all tactical moves.
    // This skips move generation entirely when the previous iteration's winning move still works.
    if (ttBest !== -1 && position.board[ttBest] === EMPTY && ttBest !== position.koPoint) {
      if (position.play(ttBest)) {
        try {
          if (position.winner !== EMPTY || this.proofDefend(position, depthLeft - 1, ply + 1)) {
            this.storeProofTT(ttIdx, hash, depthLeft, 1, ttBest);
            return true;
          }
        } finally {
          position.undo();
        }
      }
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    // Generate only tactical (forcing) moves for the attacker.
    const count = this.generateOrderedMoves(position, moves, scores, -1, true, ply);

    for (let i = 0; i < count; i += 1) {
      const m = moves[i];
      // already tried above
      if (m === ttBest) continue;
      if (position.play(m)) {
        try {
          if (position.winner !== EMPTY || this.proofDefend(position, depthLeft - 1, ply + 1)) {
            this.storeProofTT(ttIdx, hash, depthLeft, 1, m);
            return true;
          }
        } finally {
          position.undo();
        }
      }
    }

    this.storeProofTT(ttIdx, hash, depthLeft, -1);
    return false;
  }

  /**
   * Defender (AND node): ALL legal moves must fail to refute the attacker's win.
   * Generates ALL legal moves. If any defense survives, return false (not proven).
   */
  private proofDefend(position: GogoPosition, depthLeft: number, ply: number): boolean {
    this.checkTime(false);

    // Opponent (attacker) just made five - attacker wins
    if (position.winner !== EMPTY) return true;
    if (depthLeft <= 0) return false;

    // Proof TT probe
    const hash = position.hash;
    const ttIdx = Number(hash & TT_MASK);
    let ttBest = -1;
    if (this.proofTTHash[ttIdx] === hash) {
      if (this.proofTTDepth[ttIdx] >= depthLeft) {
        if (this.proofTTResult[ttIdx] === 1) return true;
        if (this.proofTTResult[ttIdx] === -1) return false;
      }
      ttBest = this.proofTTBestMove[ttIdx];
    }

    let anyLegalCount = 0;
    const triedEpoch = this.triedMoveEpoch;
    this.triedMoveEpoch += 1;

    // Hash move first: try the TT best move (refutation from previous iteration)
    // before generating all moves. Skips expensive move generation when refutation holds.
    if (ttBest !== -1 && position.board[ttBest] === EMPTY && ttBest !== position.koPoint) {
      this.triedMoveMarks[ttBest] = triedEpoch;
      if (position.play(ttBest)) {
        anyLegalCount += 1;
        try {
          if (!(position.winner === EMPTY && this.proofAttack(position, depthLeft - 1, ply + 1))) {
            this.storeProofTT(ttIdx, hash, depthLeft, -1, ttBest);
            return false;
          }
        } finally {
          position.undo();
        }
      }
    }

    // Must-respond threat restriction: when the attacker has an immediate
    // winning threat (open four), the defender MUST address it — either by
    // blocking, capturing attacker stones, or winning immediately.
    // Any other move allows the attacker to complete the four next turn.
    // Try restricted moves first for speed; fall through to full generation
    // for soundness (handles exotic cases like ko blocking the threat point).
    const threatResponses = this.findThreatResponses(position, ply);

    if (threatResponses > 0) {
      const moves = this.moveBuffers[ply];
      for (let i = 0; i < threatResponses; i += 1) {
        const m = moves[i];
        if (this.triedMoveMarks[m] === triedEpoch) continue;
        this.triedMoveMarks[m] = triedEpoch;
        if (position.play(m)) {
          anyLegalCount += 1;
          try {
            if (!(position.winner === EMPTY && this.proofAttack(position, depthLeft - 1, ply + 1))) {
              this.storeProofTT(ttIdx, hash, depthLeft, -1, m);
              return false;
            }
          } finally {
            position.undo();
          }
        }
      }

      // Without a ko restriction, the restricted response set is complete:
      // any non-response move loses immediately to the attacker's open-four threat.
      // Skip full-board defense generation for substantial speedup in puzzle proofs.
      if (position.koPoint === -1 && anyLegalCount > 0) {
        this.storeProofTT(ttIdx, hash, depthLeft, 1);
        return true;
      }
    }

    // Full generation: generate ALL legal moves.
    // Skip moves already tried in the TT-first and restricted-response stages.
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = this.generateOrderedMoves(position, moves, scores, -1, false, ply);
    let usedFullBoard = false;

    for (;;) {
      let stageLegalCount = 0;
      for (let i = 0; i < count; i += 1) {
        const m = moves[i];
        if (this.triedMoveMarks[m] === triedEpoch) continue;
        this.triedMoveMarks[m] = triedEpoch;
        if (position.play(m)) {
          anyLegalCount += 1;
          stageLegalCount += 1;
          try {
            if (!(position.winner === EMPTY && this.proofAttack(position, depthLeft - 1, ply + 1))) {
              this.storeProofTT(ttIdx, hash, depthLeft, -1, m);
              return false;
            }
          } finally {
            position.undo();
          }
        }
      }
      if (stageLegalCount !== 0 || usedFullBoard) break;
      count = this.generateFullBoardMoves(position, moves, scores, -1, false, ply);
      usedFullBoard = true;
    }

    // No legal moves → neutral (not proven). Matches search()'s neutral semantics.
    if (anyLegalCount === 0) return false;
    // All defenses exhausted - attacker's win is proven
    this.storeProofTT(ttIdx, hash, depthLeft, 1);
    return true;
  }

  /**
   * Find restricted defender responses when the attacker has an immediate
   * winning threat (open four). Returns the number of response moves written
   * to moveBuffers[ply], or -1 if no immediate threat exists.
   *
   * Response moves include:
   * 1. Blocking cells — empty cells in attacker's four-windows
   * 2. Capture cells — last-liberty cells of attacker groups
   * 3. Own-winning cells — empty cells in defender's four-windows
   *
   * This is sound because any other defender move allows the attacker to
   * complete the four on the next turn.
   */
  private findThreatResponses(position: GogoPosition, ply: number): number {
    const attacker: Player = position.toMove === BLACK ? WHITE : BLACK;
    const defender = position.toMove;
    const meta = position.meta;
    const windows = meta.windows;
    const board = position.board;

    this.candidateEpoch += 1;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = 0;
    let hasThreat = false;

    // Scan all windows for attacker's open fours and defender's open fours
    for (let wi = 0; wi < meta.windowCount; wi += 1) {
      const base = wi * 5;
      let atkCount = 0;
      let defCount = 0;
      let emptyCell = -1;
      for (let j = 0; j < 5; j += 1) {
        const c = board[windows[base + j]];
        if (c === attacker) atkCount += 1;
        else if (c === defender) defCount += 1;
        else emptyCell = windows[base + j];
      }

      // Attacker has 4 in this window with 1 empty = immediate threat
      if (atkCount === 4 && defCount === 0 && emptyCell !== -1 && emptyCell !== position.koPoint) {
        hasThreat = true;
        count = this.insertOrPromoteMove(moves, scores, count, emptyCell, 2_000_000);
      }

      // Defender has 4 in a window = can win immediately
      if (defCount === 4 && atkCount === 0 && emptyCell !== -1 && emptyCell !== position.koPoint) {
        count = this.insertOrPromoteMove(moves, scores, count, emptyCell, 3_000_000);
      }
    }

    if (!hasThreat) return -1;

    // Find capture moves: cells that are the last liberty of an attacker group.
    // Playing there captures the group, potentially breaking the four.
    this.scorerGroupEpoch += 1;
    for (let point = 0; point < position.area; point += 1) {
      if (board[point] !== attacker || this.scorerGroupMarks[point] === this.scorerGroupEpoch) continue;
      const liberties = position.scanGroup(point, attacker);
      for (let gi = 0; gi < position.scanGroupSize; gi += 1) {
        this.scorerGroupMarks[position.groupBuffer[gi]] = this.scorerGroupEpoch;
      }
      if (liberties === 1) {
        // Find the single liberty cell among the group's neighbors
        for (let gi = 0; gi < position.scanGroupSize; gi += 1) {
          const stone = position.groupBuffer[gi];
          const neighborBase = stone * 4;
          for (let offset = 0; offset < 4; offset += 1) {
            const n = meta.neighbors4[neighborBase + offset];
            if (n !== -1 && board[n] === EMPTY && n !== position.koPoint) {
              count = this.insertOrPromoteMove(moves, scores, count, n, 1_500_000);
            }
          }
        }
      }
    }

    return count;
  }
}
