import { BLACK, EMPTY, GogoPosition, otherPlayer, type Player, WHITE } from './gogomoku';
import { insertMoveDescending, sortMovesDescending } from './moveOrdering';

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  timedOut: boolean;
  /**
   * True only when exact tactical analysis confirms a unique defensive reply:
   * there is no immediate counter-win, and every other legal move allows the
   * opponent to win next turn. This does not establish the eventual outcome.
   * False also covers cases where the time budget prevented confirmation.
   */
  forcedDefensiveMove: boolean;
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
  provenWin?: boolean;
  provenLoss?: boolean;
}

const WIN_SCORE = 1_000_000_000;
const ATTACK_WEIGHTS = [0, 12, 72, 540, 100_000, 500_000] as const;
const DEFENSE_WEIGHTS = [0, 16, 96, 720, 100_000, 500_000] as const;
const EVAL_WEIGHTS = [0, 6, 32, 240, 500_000, WIN_SCORE >> 2] as const;
const LOCAL_LIBERTY_WEIGHTS = [-200, -80, 20, 60, 80] as const;
const TACTICAL_PATTERN_THRESHOLD = ATTACK_WEIGHTS[4];
const CENTER_MULTIPLIER = 0.9; // edge moves are better (see puzzles)
const HINT_BONUS = 10_000_000;
const HISTORY_SCALE = 1;
const KILLER_BONUS = 1_000_000;
const CAPTURE_BONUS = 5_000;
const ESCAPE_BONUS = 3_500;
const NO_SCORE = Number.NEGATIVE_INFINITY;
const MAX_CANDIDATES = 12;
const SHALLOW_PROOF_NODES_PER_DEPTH = 4096;
const FORCING_PROOF_MAX_DEPTH = 9;
const LOSS_PROOF_NODES_PER_DEPTH = 16384;
const WINDOW_PATTERN_BLACK = new Int32Array(36);
const WINDOW_PATTERN_WHITE = new Int32Array(36);
for (let count = 0; count < 5; count += 1) {
  // Codes are black * 6 + white. Only unopposed windows contribute;
  // the empty window receives both the attack and defense baseline.
  WINDOW_PATTERN_BLACK[count * 6] += ATTACK_WEIGHTS[count + 1];
  WINDOW_PATTERN_BLACK[count] += DEFENSE_WEIGHTS[count + 1];
  WINDOW_PATTERN_WHITE[count] += ATTACK_WEIGHTS[count + 1];
  WINDOW_PATTERN_WHITE[count * 6] += DEFENSE_WEIGHTS[count + 1];
}
const WINDOW_EVALUATION = new Int32Array(36);
for (let count = 1; count <= 5; count += 1) {
  WINDOW_EVALUATION[count * 6] = EVAL_WEIGHTS[count];
  WINDOW_EVALUATION[count] = -EVAL_WEIGHTS[count];
}

// Transposition table constants
const TT_SIZE_BITS = 18;
const TT_SIZE = 1 << TT_SIZE_BITS;
const TT_MASK = BigInt(TT_SIZE - 1);
const QTT_SIZE = 1 << 12;
const QTT_MASK = BigInt(QTT_SIZE - 1);
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
  private scoreBuffers: Float64Array[] = [];
  private history = new Int32Array(0);
  private candidateMarks = new Uint32Array(0);
  private candidateEpoch = 1;
  private triedMoveMarks = new Uint32Array(0);
  private proofAttackMarks = new Uint8Array(0);
  private triedMoveEpoch = 1;
  private scorerGroupMarks = new Uint32Array(0);
  private scorerGroupEpoch = 1;
  private scoredGroupEpoch = new Uint32Array(0);
  private scoredGroupLiberties = new Uint8Array(0);
  private scoredGroupSizes = new Uint8Array(0);
  private scoredGroupRoots = new Int16Array(0);
  private scoredGroupPassEpoch = 1;
  private scoredGroupHash = -1n;
  private windowBoard = new Uint8Array(0);
  private windowBlack = new Uint8Array(0);
  private windowWhite = new Uint8Array(0);
  private activeWindows = new Uint32Array(0);
  private windowHash = -1n;
  private windowEvaluation = 0;
  private evaluationBoard = new Uint8Array(0);
  private localScores = new Int32Array(0);
  private localEvaluation = 0;
  private pointPatternBlack = new Int32Array(0);
  private pointPatternWhite = new Int32Array(0);
  private patternsReady = false;
  private patternDirty = new Uint8Array(0);
  private dirtyWindows = new Int16Array(0);
  private patternCodes = new Uint8Array(0);
  private dirtyWindowCount = 0;
  private bufferArea = 0;
  private deadline = 0;
  private nodesVisited = 0;
  private timedOut = false;
  private fallbackWins = false;
  private killerMoves = new Int16Array(0);
  private readonly timeoutSignal = new Error('SEARCH_TIMEOUT');
  private proofMode = false;
  private lossProofMode = false;
  private forcingProofMode = false;
  private verifiedWinDepth = 0;
  private proofNodeLimit = Infinity;

  // Transposition table
  private qHash = new BigUint64Array(QTT_SIZE);
  private qScore = new Float64Array(QTT_SIZE);
  private qDepth = new Int16Array(QTT_SIZE);
  private qFlag = new Uint8Array(QTT_SIZE);

  private ttHash = new BigUint64Array(TT_SIZE);
  private ttScore = new Float64Array(TT_SIZE);
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
    this.windowHash = -1n;
    this.resetSearchHeuristics();
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;
    this.proofMode = false;

    // Early exits share the same neutral defaults. Outcome flags are set only
    // by the terminal check, exact tactical analysis, or independent proof.
    const result: SearchResult = {
      move: -1, score: 0, depth: 0, nodes: 0, timedOut: false,
      forcedDefensiveMove: false, forcedWin: false, forcedLoss: false,
      heuristicWin: false, heuristicLoss: false,
    };
    if (position.winner !== EMPTY) {
      result.score = -WIN_SCORE;
      result.forcedLoss = result.heuristicLoss = true;
      return result;
    }

    const state: SearchState = {
      bestMove: this.pickFallbackMove(position),
      bestScore: 0,
      completedDepth: 0,
      hintMove: -1,
    };
    const fallbackMove = state.bestMove;
    if (fallbackMove === -1 || this.now() >= this.deadline) {
      result.move = fallbackMove;
      result.timedOut = fallbackMove !== -1;
      return result;
    }

    state.hintMove = fallbackMove;
    // The fallback legality check already tells us when our own immediate win
    // takes precedence. Avoid an unnecessary defensive scan in that case.
    const forcedDefensiveMove = this.fallbackWins ? -1 : this.findForcedDefensiveMove(position);
    if (forcedDefensiveMove !== -1) {
      // The tactical scan consumes the same budget as deeper search. Once the
      // deadline expires, return the legal fallback without claiming a defense.
      const timedOut = this.now() >= this.deadline;
      // Choosing the only move that avoids losing next turn needs no deeper
      // evaluation. It does not establish a forced win or loss after the reply.
      result.move = timedOut ? fallbackMove : forcedDefensiveMove;
      result.timedOut = timedOut;
      result.forcedDefensiveMove = !timedOut;
      return result;
    }
    // === Phase 1: Heuristic Discovery ===
    // Use NMP, LMR, and candidate capping for fast search.
    this.searchDepths(position, 1, state, this.maxDepth, true);

    const heuristicWin = !state.provenWin && this.isForcedWinScore(state.bestScore, state.completedDepth);
    const heuristicLoss = this.isForcedLossScore(state.bestScore, state.completedDepth);
    let provenWin = !!state.provenWin;
    let provenLoss = !!state.provenLoss;

    // === Phase 2: Proof ===
    // When the heuristic search found a forced outcome, verify with exact search.
    // For wins: use AND/OR threat-space prover (fast for tactical wins).
    // For losses: verify an opponent win after every legal defense.
    if (!provenLoss && (heuristicWin || heuristicLoss) && this.now() < this.deadline) {
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
        // Prove an opponent win after every legal defense. Discovery scores
        // supply ordering hints only; the threat-space prover verifies each win.
        try {
          const score = this.proofSearchRoot(position, state.completedDepth, state.bestMove);
          provenLoss = this.isForcedLossScore(score, state.completedDepth);
          proofFailed = !provenLoss;
        } catch (error) {
          if (error !== this.timeoutSignal) throw error;
          this.timedOut = true;
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

    result.move = state.bestMove;
    result.score = state.bestScore;
    result.depth = state.completedDepth;
    result.nodes = this.nodesVisited;
    result.timedOut = this.timedOut;
    result.forcedWin = provenWin;
    result.forcedLoss = provenLoss;
    // Recompute after a resumed discovery search. An early exact win bypassed
    // heuristic mate discovery, so it retains only its proven-win flag.
    result.heuristicWin = !state.provenWin && this.isForcedWinScore(state.bestScore, state.completedDepth);
    result.heuristicLoss = this.isForcedLossScore(state.bestScore, state.completedDepth);
    return result;
  }

  private ensureBuffers(area: number): void {
    if (this.bufferArea === area) {
      return;
    }
    this.bufferArea = area;
    this.windowBoard = new Uint8Array(area);
    this.windowBlack = new Uint8Array(4 * area);
    this.windowWhite = new Uint8Array(4 * area);
    const size = Math.sqrt(area);
    this.activeWindows = new Uint32Array(Math.ceil((size - 4) * (4 * size - 8) / 32));
    this.windowEvaluation = 0;
    this.evaluationBoard = new Uint8Array(area);
    this.localScores = new Int32Array(area);
    this.localEvaluation = 0;
    this.pointPatternBlack = new Int32Array(area);
    this.pointPatternWhite = new Int32Array(area);
    this.patternsReady = false;
    this.patternDirty = new Uint8Array(4 * area);
    this.dirtyWindows = new Int16Array(4 * area);
    this.patternCodes = new Uint8Array(4 * area);
    this.dirtyWindowCount = 0;
    this.windowHash = -1n;
    this.moveBuffers = new Array(this.maxPly + 1);
    this.scoreBuffers = new Array(this.maxPly + 1);
    for (let ply = 0; ply <= this.maxPly; ply += 1) {
      this.moveBuffers[ply] = new Int16Array(area);
      this.scoreBuffers[ply] = new Float64Array(area);
    }
    this.history = new Int32Array(area * 2);
    this.candidateMarks = new Uint32Array(area);
    this.candidateEpoch = 1;
    this.triedMoveMarks = new Uint32Array(area);
    this.proofAttackMarks = new Uint8Array(area * (this.maxPly + 1));
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
    if (clearTT) {
      this.ttFlag.fill(0);
      this.qFlag.fill(0);
    }
  }

  private searchDepths(position: GogoPosition, startDepth: number, state: SearchState, endDepth = this.maxDepth, earlyProof = false): void {
    let earlyProofTried = false;
    let shallowProofTried = false;
    let earlyLossTried = false;
    for (let depth = startDepth; depth <= endDepth; depth += 1) {
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
        if (earlyProof && !earlyLossTried && depth >= 3 && depth + 3 <= Math.min(endDepth, this.maxPly) && result.score <= -EVAL_WEIGHTS[4]) {
          earlyLossTried = true;
          if (this.tryEarlyLossProof(position, state, depth + 3)) break;
        }
        // A bounded shallow proof can settle stable tactical setups
        // before expensive discovery. Failure leaves the full search available.
        if (earlyProof && !shallowProofTried && depth <= 3 && endDepth >= 5 && result.score >= ATTACK_WEIGHTS[2]) {
          shallowProofTried = true;
          if (this.tryEarlyProof(position, state, SHALLOW_PROOF_NODES_PER_DEPTH * this.maxDepth)) break;
        }
        // A strong tactical candidate often appears before discovery finds its
        // mate score. Try a bounded independent proof at the first promising
        // depth, retaining most of the budget for discovery if it cannot win.
        if (earlyProof && !earlyProofTried && depth >= 3 && depth < endDepth && result.score >= EVAL_WEIGHTS[4] / 2) {
          earlyProofTried = true;
          if (this.tryEarlyProof(position, state)) break;
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

  private tryEarlyProof(position: GogoPosition, state: SearchState, nodeLimit = Infinity): boolean {
    const deadline = this.deadline;
    const nodes = this.nodesVisited;
    const previousNodeLimit = this.proofNodeLimit;
    this.proofNodeLimit = nodeLimit;
    const history = this.history.slice();
    const killers = this.killerMoves.slice();
    try {
      if (!this.verifyWinningMove(position, state.bestMove, (deadline - this.now()) / 4, this.maxDepth)) {
        if (this.timedOut) return false;
        // The heuristic's first choice can hide a winning quiet setup. Probe
        // alternatives with an independent bounded root proof before spending
        // the remaining budget on deeper heuristic iterations.
        this.proofNodeLimit = this.nodesVisited + nodeLimit;
        this.resetProofSearch();
        const depth = Math.min(this.maxDepth, FORCING_PROOF_MAX_DEPTH);
        try {
          if (!this.proofAttack(position, depth, 0)) return false;
        } catch (error) {
          if (error !== this.timeoutSignal) throw error;
          return false;
        }
        state.bestMove = this.proofTTBestMove[Number(position.hash & TT_MASK)];
        state.hintMove = state.bestMove;
        this.verifiedWinDepth = depth;
      }
      state.bestScore = WIN_SCORE - this.verifiedWinDepth;
      state.completedDepth = this.verifiedWinDepth;
      state.provenWin = true;
      return true;
    } finally {
      this.deadline = deadline;
      this.proofNodeLimit = previousNodeLimit;
      this.nodesVisited += nodes;
      this.history.set(history);
      this.killerMoves.set(killers);
      this.timedOut = this.now() >= deadline;
    }
  }

  private tryEarlyLossProof(position: GogoPosition, state: SearchState, depth: number): boolean {
    const deadline = this.deadline;
    const nodeLimit = this.proofNodeLimit;
    const history = this.history.slice();
    const killers = this.killerMoves.slice();
    this.deadline = this.now() + (deadline - this.now()) / 4;
    this.proofNodeLimit = this.nodesVisited + LOSS_PROOF_NODES_PER_DEPTH * this.maxDepth;
    try {
      const score = this.proofSearchRoot(position, depth, state.bestMove);
      if (!this.isForcedLossScore(score, depth)) return false;
      state.bestScore = score;
      state.completedDepth = depth;
      state.provenLoss = true;
      return true;
    } catch (error) {
      if (error !== this.timeoutSignal) throw error;
      return false;
    } finally {
      this.deadline = deadline;
      this.proofNodeLimit = nodeLimit;
      this.history.set(history);
      this.killerMoves.set(killers);
      this.timedOut = this.now() >= deadline;
    }
  }

  private isForcedWinScore(score: number, depth: number): boolean {
    return score >= WIN_SCORE - depth;
  }

  private isForcedLossScore(score: number, depth: number): boolean {
    return score <= -WIN_SCORE + depth;
  }

  private findForcedDefensiveMove(position: GogoPosition): number {
    const count = this.findThreatResponses(position, 0);
    if (count < 0) return -1;

    const moves = this.moveBuffers[0];
    let reply = -1;
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      if (!position.play(move)) continue;
      try {
        // Keep immediate wins on the normal search/proof path so their scores
        // and outcome flags retain their meaning.
        if (position.winner !== EMPTY) return -1;
        if (this.findImmediateWin(position) === -1) {
          if (reply !== -1) return -1;
          reply = move;
        }
      } finally {
        position.undo();
      }
    }
    return reply;
  }

  private findImmediateWin(position: GogoPosition): number {
    this.ensureBuffers(position.area);
    return this.findThreatResponses(position, 0, true);
  }

  private pickFallbackMove(position: GogoPosition): number {
    this.fallbackWins = false;
    if (position.stoneCount === 0) {
      return ((position.size >> 1) * position.size) + (position.size >> 1);
    }

    const moves = this.moveBuffers[0];
    const scores = this.scoreBuffers[0];
    // Broaden to distant moves only if every nearby candidate is illegal.
    for (let stage = 0; stage < 2; stage += 1) {
      const count = stage === 0
        ? this.generateOrderedMoves(position, moves, scores, -1, false)
        : this.generateFullBoardMoves(position, moves, scores, -1, false);
      for (let i = 0; i < count; i += 1) {
        if (!position.play(moves[i])) continue;
        this.fallbackWins = position.winner !== EMPTY;
        position.undo();
        return moves[i];
      }
    }

    return -1;
  }

  /** Prove a winning opponent reply after EVERY legal defense, including distant moves. */
  private proofSearchRoot(position: GogoPosition, depth: number, hintMove: number): number {
    this.checkTime(true);
    const count = this.generateFullBoardMoves(position, this.moveBuffers[0], this.scoreBuffers[0], hintMove, false);
    // Child discovery uses the root buffers too. Keep the defense list intact.
    const defenses = this.moveBuffers[0].slice(0, count);
    let legalCount = 0;
    let winningReply = -1;
    this.resetProofSearch();
    const savedProofMode = this.proofMode;
    // Every witness in this root search uses forcing attacks and exhaustive
    // defenses. Heuristic child discovery does not consult lossProofMode.
    this.lossProofMode = true;
    try {
      for (const defense of defenses) {
        this.checkTime(true);
        if (!position.play(defense)) continue;
        legalCount++;
        try {
          if (position.winner !== EMPTY) return 0;
          const index = Number(position.hash & TT_MASK);
          const hint = this.ttHash[index] === position.hash ? this.ttBestMove[index] : -1;
          if (hint !== -1 && this.proveAttackMove(position, hint, depth - 1)) {
            winningReply = hint;
            continue;
          }
          if (winningReply !== -1 && winningReply !== hint && this.proveAttackMove(position, winningReply, depth - 1)) continue;
          // Try concrete forcing replies before relying on a heuristic witness.
          // Every candidate is independently proved; failed attacks leave the
          // ordinary discovery search available.
          const replyCount = this.generateTacticalMoves(position, this.moveBuffers[1], this.scoreBuffers[1], hint, 1, true, 2);
          const replies = this.moveBuffers[1].slice(0, replyCount);
          let provedReply = false;
          for (const reply of replies) {
            this.checkTime(true);
            if (reply === hint || reply === winningReply) continue;
            if (this.proveAttackMove(position, reply, depth - 1)) {
              winningReply = reply;
              provedReply = true;
              break;
            }
          }
          if (provedReply) continue;
          this.proofMode = false;
          const state: SearchState = {
            bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1,
          };
          this.searchDepths(position, 1, state, depth - 1);
          if (!this.isForcedWinScore(state.bestScore, state.completedDepth)) return 0;
          this.checkTime(true);
          if (!this.proveAttackMove(position, state.bestMove, state.completedDepth)) return 0;
          winningReply = state.bestMove;
        } finally {
          position.undo();
        }
      }
      return legalCount === 0 ? 0 : -WIN_SCORE + depth;
    } finally {
      this.proofMode = savedProofMode;
      this.lossProofMode = false;
    }
  }

  /** Prove a concrete attack, restoring the position even on timeout. */
  private proveAttackMove(position: GogoPosition, move: number, depth: number, ply = 1): boolean {
    if (!position.play(move)) return false;
    try {
      return this.proofDefend(position, depth, ply);
    } finally {
      position.undo();
    }
  }

  private searchRoot(position: GogoPosition, depth: number, hintMove: number): { move: number; score: number } {
    this.checkTime(true);
    const result = { move: -1, score: 0 };
    result.score = this.searchMoves(position, depth, -WIN_SCORE, WIN_SCORE, 0, hintMove, -1, result);
    return result;
  }

  private search(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, canNullMove = true): number {
    this.checkTime(false);
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }
    if (depth <= 0 || ply >= this.maxPly) {
      return this.quiescence(position, alpha, beta, ply, this.quiescenceDepth);
    }

    // Transposition table probe
    const hash = position.hash;
    const ttIndex = Number(hash & TT_MASK);
    let ttBest = -1;
    // Extract ordering hints even when the score flag was cleared. Score
    // cutoffs additionally require a valid entry at sufficient depth.
    if (this.ttHash[ttIndex] === hash) {
      ttBest = this.ttBestMove[ttIndex];
      if (this.ttFlag[ttIndex] !== TT_NONE && this.ttDepth[ttIndex] >= depth) {
        const ttFlag = this.ttFlag[ttIndex];
        const ttScore = this.adjustMateScore(this.ttScore[ttIndex], -ply);
        if (ttFlag === TT_EXACT
          || (ttFlag === TT_LOWERBOUND && ttScore >= beta)
          || (ttFlag === TT_UPPERBOUND && ttScore <= alpha)) return ttScore;
      }
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

    const responses = this.findThreatResponses(position, ply);
    return this.searchMoves(position, depth, alpha, beta, ply, ttBest, responses);
  }

  /**
   * Shared root and inner-node move search. Root discovery searches every
   * candidate at depth one and stops at a winning witness; inner nodes use
   * the caller's beta bound and store only sound bounds from capped lists.
   * Full-board fallback is generated only when no nearby candidate is legal.
   */
  private searchMoves(
    position: GogoPosition,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    hintMove: number,
    responses: number,
    rootResult?: { move: number },
  ): number {
    const root = rootResult !== undefined;
    const originalAlpha = alpha;
    const cutoff = root ? WIN_SCORE - (this.proofMode ? 1 : depth) : beta;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let wasCapped = false;
    let legalCount = 0;
    let bestScore = -WIN_SCORE;
    let bestMove = -1;

    for (let stage = 0; stage < 2; stage += 1) {
      let count: number;
      if (stage === 0) {
        count = responses >= 0 ? responses : this.generateOrderedMoves(position, moves, scores, hintMove, false, ply);
      } else {
        count = this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply);
      }
      if (!this.proofMode && (!root || (stage === 0 && depth > 1)) && count > MAX_CANDIDATES) {
        count = MAX_CANDIDATES;
        wasCapped = true;
      }
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (!position.play(move)) {
          continue;
        }
        legalCount += 1;
        let score = 0;
        try {
          score = this.searchChild(position, depth, alpha, beta, ply + 1, legalCount, root);
        } finally {
          position.undo();
        }
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score <= alpha) continue;
        alpha = score;
        if (alpha >= cutoff) {
          if (root) break;
          this.history[(position.toMove - 1) * this.bufferArea + move] += depth * depth * HISTORY_SCALE;
          this.recordKillerMove(ply, move);
          break;
        }
      }
      if (legalCount !== 0) break;
    }

    if (legalCount === 0) {
      return 0;
    }

    // Root callers need a move, but inner nodes return a number without
    // allocating a result object. Recursive children cannot overwrite locals.
    if (rootResult !== undefined) {
      rootResult.move = bestMove;
      return bestScore;
    }

    const hash = position.hash;
    const ttIndex = Number(hash & TT_MASK);
    // Transposition table store
    // Capped nodes (MAX_CANDIDATES applied) may have missed legal defenses.
    // Only TT_LOWERBOUND (fail-high on a real move) is safe from capped nodes.
    // TT_EXACT and TT_UPPERBOUND may be wrong because unsearched moves could
    // have produced a higher score.
    const storeFlag = bestScore <= originalAlpha ? TT_UPPERBOUND
                    : alpha >= beta ? TT_LOWERBOUND
                    : TT_EXACT;
    this.ttHash[ttIndex] = hash;
    this.ttBestMove[ttIndex] = bestMove;
    this.ttFlag[ttIndex] = TT_NONE;
    if (!wasCapped || storeFlag === TT_LOWERBOUND) {
      this.ttScore[ttIndex] = this.adjustMateScore(bestScore, ply);
      this.ttDepth[ttIndex] = depth;
      this.ttFlag[ttIndex] = storeFlag;
    }

    return bestScore;
  }

  /**
   * PVS: search the first legal child fully, then scout later moves and
   * re-search improvements. Root iterations below depth four use full windows;
   * only non-root discovery applies late-move reductions (LMR).
   * The caller owns make/undo, so every re-search sees the same child position.
   */
  private searchChild(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, legalCount: number, root = false): number {
    if (legalCount === 1 || (root && depth < 4)) {
      return -this.search(position, depth - 1, -beta, -alpha, ply);
    }
    let searchDepth = depth - 1;
    // LMR is heuristic and remains disabled in exact numeric searches.
    if (!root && !this.proofMode && depth >= 3 && legalCount > 3) {
      searchDepth = Math.max(1, searchDepth - 1);
    }
    let score = -this.search(position, searchDepth, -alpha - 1, -alpha, ply);
    if (searchDepth < depth - 1 && score > alpha) {
      score = -this.search(position, depth - 1, -alpha - 1, -alpha, ply);
    }
    if (score > alpha && score < beta) {
      score = -this.search(position, depth - 1, -beta, -alpha, ply);
    }
    return score;
  }

  private quiescence(position: GogoPosition, alpha: number, beta: number, ply: number, remainingDepth: number): number {
    this.checkTime(false);
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }

    const hash = position.hash;
    const index = Number(hash & QTT_MASK);
    const searchDepth = Math.min(remainingDepth, this.maxPly - ply);
    const originalAlpha = alpha;
    if (this.qHash[index] === hash && this.qDepth[index] === searchDepth) {
      const cached = this.adjustMateScore(this.qScore[index], -ply);
      const flag = this.qFlag[index];
      if (flag === TT_EXACT || (flag === TT_LOWERBOUND && cached >= beta) || (flag === TT_UPPERBOUND && cached <= alpha)) return cached;
    }
    const store = (score: number): number => {
      this.qHash[index] = hash;
      this.qDepth[index] = searchDepth;
      this.qScore[index] = this.adjustMateScore(score, ply);
      this.qFlag[index] = score >= beta ? TT_LOWERBOUND : score <= originalAlpha ? TT_UPPERBOUND : TT_EXACT;
      return score;
    };

    const standPat = this.evaluate(position);
    if (remainingDepth === 0 || ply >= this.maxPly) {
      return store(standPat);
    }
    // A large positive static score suggests an own four. Confirm its legality
    // exactly before avoiding tactical generation; smaller scores take the
    // normal path without an extra window scan.
    if (standPat >= EVAL_WEIGHTS[4] / 2 && this.findImmediateWin(position) !== -1) {
      return store(WIN_SCORE - ply - 1);
    }

    const responses = this.findThreatResponses(position, ply);
    if (responses < 0) {
      if (standPat >= beta) return store(standPat);
      alpha = Math.max(alpha, standPat);
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    const count = responses >= 0 ? responses : this.generateOrderedMoves(position, moves, scores, -1, true);
    let bestScore = responses >= 0 ? -WIN_SCORE : standPat;
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
      bestScore = Math.max(bestScore, score);
      if (score <= alpha) continue;
      alpha = score;
      if (alpha >= beta) return store(score);
    }

    return store(legalCount === 0 ? standPat : bestScore);
  }

  /** Share incremental five-cell counts across scoring, evaluation and threats. */
  private beginWindowPass(position: GogoPosition): void {
    if (this.windowHash === position.hash) return;
    const board = position.board;
    const meta = position.meta;
    for (let point = 0; point < position.area; point += 1) {
      const oldCell = this.windowBoard[point];
      const cell = board[point];
      if (cell === oldCell) continue;
      const blackDelta = (cell & 1) - (oldCell & 1);
      const whiteDelta = (cell >> 1) - (oldCell >> 1);
      for (let cursor = meta.windowsByPointOffsets[point]; cursor < meta.windowsByPointOffsets[point + 1]; cursor += 1) {
        const wi = meta.windowsByPoint[cursor];
        if (this.patternDirty[wi] === 0) {
          this.patternDirty[wi] = 1;
          this.dirtyWindows[this.dirtyWindowCount++] = wi;
        }
        this.windowBlack[wi] += blackDelta;
        this.windowWhite[wi] += whiteDelta;
        const black = this.windowBlack[wi];
        const white = this.windowWhite[wi];
        const bit = 1 << (wi & 31);
        if ((black >= 2 && white === 0) || (white >= 2 && black === 0)) {
          this.activeWindows[wi >>> 5] |= bit;
        } else {
          this.activeWindows[wi >>> 5] &= ~bit;
        }
      }
      this.windowBoard[point] = cell;
    }
    this.windowHash = position.hash;
  }

  /** Defer point scores until needed; immediate proof nodes only need counts. */
  private beginPatternPass(position: GogoPosition): void {
    this.beginWindowPass(position);
    const meta = position.meta;
    if (!this.patternsReady) {
      for (let point = 0; point < position.area; point += 1) {
        const baseline = (meta.windowsByPointOffsets[point + 1] - meta.windowsByPointOffsets[point]) * WINDOW_PATTERN_BLACK[0];
        this.pointPatternBlack[point] = baseline;
        this.pointPatternWhite[point] = baseline;
      }
      this.patternsReady = true;
    }
    for (let index = 0; index < this.dirtyWindowCount; index += 1) {
      const wi = this.dirtyWindows[index];
      const code = this.windowBlack[wi] * 6 + this.windowWhite[wi];
      const oldCode = this.patternCodes[wi];
      this.patternCodes[wi] = code;
      this.patternDirty[wi] = 0;
      this.windowEvaluation += WINDOW_EVALUATION[code] - WINDOW_EVALUATION[oldCode];
      const blackDelta = WINDOW_PATTERN_BLACK[code] - WINDOW_PATTERN_BLACK[oldCode];
      const whiteDelta = WINDOW_PATTERN_WHITE[code] - WINDOW_PATTERN_WHITE[oldCode];
      if (blackDelta !== 0 || whiteDelta !== 0) {
        for (let offset = 0; offset < 5; offset += 1) {
          const affected = meta.windows[wi * 5 + offset];
          this.pointPatternBlack[affected] += blackDelta;
          this.pointPatternWhite[affected] += whiteDelta;
        }
      }
    }
    this.dirtyWindowCount = 0;
  }

  private evaluate(position: GogoPosition): number {
    this.beginPatternPass(position);
    const board = position.board;
    const neighbors = position.meta.neighbors4;
    for (let point = 0; point < position.area; point += 1) {
      if (board[point] === this.evaluationBoard[point]) continue;
      this.evaluationBoard[point] = board[point];
      this.updateLocalScore(position, point);
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = neighbors[point * 4 + offset];
        if (neighbor !== -1) this.updateLocalScore(position, neighbor);
      }
    }
    const score = this.windowEvaluation + this.localEvaluation / 10;
    return position.toMove === BLACK ? score : -score;
  }

  private updateLocalScore(position: GogoPosition, point: number): void {
    const cell = position.board[point];
    let score = 0;
    if (cell !== EMPTY) {
      let liberties = 0;
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = position.meta.neighbors4[point * 4 + offset];
        if (position.board[neighbor] === EMPTY) liberties += 1;
      }
      // Integer tenths retain the fractional center bias without accumulated
      // rounding error as moves and captures are repeatedly played and undone.
      score = position.meta.centerBias[point] * 9 + LOCAL_LIBERTY_WEIGHTS[liberties] * 10;
      if (cell === WHITE) score = -score;
    }
    this.localEvaluation += score - this.localScores[point];
    this.localScores[point] = score;
  }

  private generateOrderedMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Float64Array,
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
    if (tacticalOnly) {
      return this.generateTacticalMoves(position, moves, scores, hintMove, ply);
    }
    this.candidateEpoch += 1;
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
        this.candidateMarks[move] = this.candidateEpoch;
        moves[count] = move;
        count += 1;
      }
    }

    return this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply, false, count);
  }

  private generateTacticalMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Float64Array,
    hintMove: number,
    ply: number,
    attackingOnly = false,
    minimumStones = 3,
  ): number {
    const player = position.toMove;
    const opponent = otherPlayer(player);
    const board = position.board;
    const meta = position.meta;
    const windows = meta.windows;

    this.beginWindowPass(position);
    const mineCounts = player === BLACK ? this.windowBlack : this.windowWhite;
    const theirCounts = player === BLACK ? this.windowWhite : this.windowBlack;

    this.candidateEpoch += 1;

    for (let word = 0; word < this.activeWindows.length; word += 1) {
      let bits = this.activeWindows[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const windowIndex = word * 32 + 31 - Math.clz32(bit);
        const base = windowIndex * 5;
        const mine = mineCounts[windowIndex];
        const theirs = theirCounts[windowIndex];
        if (!((theirs === 0 && mine >= minimumStones) || (!attackingOnly && mine === 0 && theirs >= 3))) continue;
        // Every empty point of a qualifying window is a candidate. Mark it
        // directly; the epoch already deduplicates overlapping windows.
        for (let offset = 0; offset < 5; offset += 1) {
          const point = windows[base + offset];
          if (board[point] === EMPTY && point !== position.koPoint) {
            this.candidateMarks[point] = this.candidateEpoch;
          }
        }
      }
    }

    this.appendGroupTacticalMoves(position, opponent);
    if (!attackingOnly) this.appendGroupTacticalMoves(position, player);

    // Candidate marking establishes emptiness and ko legality. Share the
    // scoring and stable sorting path with full-board generation.
    return this.generateFullBoardMoves(position, moves, scores, hintMove, !attackingOnly, ply, true);
  }

  /**
   * Discover liberties of tactical groups once per group. With responsePly < 0,
   * mark one- and two-liberty groups for later scoring. Otherwise append only
   * one-liberty captures to that ply's existing, priority-sorted response list.
   */
  private appendGroupTacticalMoves(
    position: GogoPosition,
    groupColor: Player,
    responsePly = -1,
    count = 0,
  ): number {
    const board = position.board;
    const neighbors = position.meta.neighbors4;
    const maximumLiberties = responsePly < 0 ? 2 : 1;

    this.scorerGroupEpoch += 1;
    const groupEpoch = this.scorerGroupEpoch;
    for (let point = 0; point < position.area; point += 1) {
      if (board[point] !== groupColor || this.scorerGroupMarks[point] === groupEpoch) {
        continue;
      }
      const liberties = position.scanGroup(point, groupColor);
      const size = position.scanGroupSize;
      for (let index = 0; index < size; index += 1) {
        this.scorerGroupMarks[position.groupBuffer[index]] = groupEpoch;
      }
      // Tactical discovery includes escapes and pressure at two liberties.
      // Immediate-threat responses require an actual one-liberty capture.
      if (liberties < 1 || liberties > maximumLiberties) continue;
      for (let index = 0; index < size; index += 1) {
        const stone = position.groupBuffer[index];
        const neighborBase = stone * 4;
        for (let offset = 0; offset < 4; offset += 1) {
          const neighbor = neighbors[neighborBase + offset];
          // Off-board -1 reads as undefined, which is not EMPTY.
          if (board[neighbor] !== EMPTY || neighbor === position.koPoint) {
            continue;
          }
          if (responsePly < 0) {
            // Marking is idempotent for liberties shared by several stones.
            this.candidateMarks[neighbor] = this.candidateEpoch;
          } else {
            // Preserve higher-priority counter-wins and blocks already present.
            count = this.insertOrPromoteMove(
              this.moveBuffers[responsePly], this.scoreBuffers[responsePly],
              count, neighbor, 1_500_000,
            );
          }
        }
      }
    }
    return count;
  }

  /**
   * Score and stably sort candidates. Without an explicit prefix, enumerate
   * empty board points (optionally restricted to tactical marks). Nearby
   * discovery supplies its own prefix to preserve its original stable ties.
   * Compaction writes only behind the read cursor, so in-place scoring is safe.
   */
  private generateFullBoardMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Float64Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply = 0,
    markedOnly = false,
    candidateCount?: number,
  ): number {
    let count = 0;
    const limit = candidateCount ?? position.area;
    for (let cursor = 0; cursor < limit; cursor += 1) {
      const move = candidateCount === undefined ? cursor : moves[cursor];
      if (candidateCount === undefined && (markedOnly
        ? this.candidateMarks[move] !== this.candidateEpoch
        : position.board[move] !== EMPTY || move === position.koPoint)) {
        continue;
      }
      const score = this.scoreMove(position, move, hintMove, tacticalOnly, ply);
      if (score === NO_SCORE) {
        continue;
      }
      moves[count] = move;
      scores[count] = score;
      count += 1;
    }
    sortMovesDescending(moves, scores, count);
    return count;
  }

  private primeScoredGroupInfo(position: GogoPosition, point: number, color: Player): void {
    if (this.scoredGroupHash !== position.hash) {
      this.scoredGroupPassEpoch += 1;
      this.scoredGroupHash = position.hash;
    }
    if (this.scoredGroupEpoch[point] === this.scoredGroupPassEpoch) return;
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

  private finalizeMoveScore(position: GogoPosition, move: number, player: Player, baseScore: number, hintMove: number, ply: number): number {
    let score = baseScore;
    score += position.meta.centerBias[move] * CENTER_MULTIPLIER;
    score += this.history[(player - 1) * this.bufferArea + move];
    if (move === hintMove) {
      score += HINT_BONUS;
    }
    if (move === this.killerMoves[ply * 2] || move === this.killerMoves[ply * 2 + 1]) {
      score += KILLER_BONUS;
    }
    return score;
  }

  private scoreMove(position: GogoPosition, move: number, hintMove: number, tacticalOnly: boolean, ply = 0): number {
    const player = position.toMove;
    const opponent = otherPlayer(player);
    const meta = position.meta;
    const board = position.board;
    this.beginPatternPass(position);
    const pattern = player === BLACK ? this.pointPatternBlack[move] : this.pointPatternWhite[move];

    // A point belongs to at most 20 windows. Without a four-stone window,
    // their combined attack/defense weights stay below the tactical threshold.
    if (tacticalOnly && pattern >= TACTICAL_PATTERN_THRESHOLD) {
      return this.finalizeMoveScore(position, move, player, pattern, hintMove, ply);
    }

    let groupPressure = 0;
    const neighbors = meta.neighbors4;
    const neighborBase = move * 4;
    this.scorerGroupEpoch += 1;
    for (let offset = 0; offset < 4; offset += 1) {
      const neighbor = neighbors[neighborBase + offset];
      if (neighbor === -1 || board[neighbor] === EMPTY) continue;
      const cell = board[neighbor] as Player;
      this.primeScoredGroupInfo(position, neighbor, cell);
      const root = this.scoredGroupRoots[neighbor];
      if (this.scorerGroupMarks[root] === this.scorerGroupEpoch) continue;
      this.scorerGroupMarks[root] = this.scorerGroupEpoch;
      const liberties = this.scoredGroupLiberties[neighbor];
      const size = this.scoredGroupSizes[neighbor];
      // Captures and escapes share group traversal and deduplication. Only
      // their weights differ; groups with more liberties exert no pressure.
      if (liberties === 1) {
        groupPressure += cell === opponent ? CAPTURE_BONUS + size * 300 : ESCAPE_BONUS + size * 250;
      } else if (liberties === 2) {
        groupPressure += size * (cell === opponent ? 30 : 20);
      }
    }

    if (tacticalOnly && groupPressure === 0) return NO_SCORE;
    return this.finalizeMoveScore(position, move, player, pattern + groupPressure, hintMove, ply);
  }

  private insertOrPromoteMove(moves: Int16Array, scores: Float64Array, count: number, move: number, score: number): number {
    if (this.candidateMarks[move] !== this.candidateEpoch) {
      this.candidateMarks[move] = this.candidateEpoch;
      insertMoveDescending(moves, scores, count, move, score);
      return count + 1;
    }

    for (let index = 0; index < count; index += 1) {
      if (moves[index] !== move) continue;
      if (score <= scores[index]) return count;
      // Reinsert within the existing prefix, preserving stable equal scores.
      insertMoveDescending(moves, scores, index, move, score);
      return count;
    }

    // Defensive fallback: a stale mark may remain even when the move is absent
    // from the current buffer (for example in white-box tests that seed marks
    // directly). Treat it as already known and leave the ordering unchanged.
    return count;
  }

  private checkTime(force: boolean): void {
    this.nodesVisited += 1;
    if (this.nodesVisited >= this.proofNodeLimit || ((force || (this.nodesVisited & 127) === 0) && this.now() >= this.deadline)) {
      throw this.timeoutSignal;
    }
  }

  /** Convert mate distance to the TT with +ply, or back to the node with -ply. */
  private adjustMateScore(score: number, ply: number): number {
    if (score >= WIN_SCORE - this.maxPly) return score + ply;
    if (score <= -WIN_SCORE + this.maxPly) return score - ply;
    return score;
  }

  // === AND/OR Threat-Space Prover ===
  // Dedicated prover for forced-win verification using attacker/defender recursion.
  // Attacker tries threats and longer tactical setups; defender checks refutations.
  // This is much faster than full negamax for proving tactical wins.
  private proofTTHash = new BigUint64Array(TT_SIZE);
  // 1 = proven win, -1 = no forcing win within stored depth, 0 = unknown
  private proofTTResult = new Int8Array(TT_SIZE);
  private proofTTDepth = new Int8Array(TT_SIZE);
  private proofTTBestMove = new Int16Array(TT_SIZE);

  private resetProofSearch(): void {
    // Clear dedicated proof results and history/killers. Heuristic TT scores
    // never serve as proofs; legal move hints are independently verified.
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
  verifyWinningMove(position: GogoPosition, move: number, timeLimitMs: number, depthLimit = this.maxPly): boolean {
    this.ensureBuffers(position.area);
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;
    this.resetProofSearch();
    this.verifiedWinDepth = 0;

    if (!position.play(move)) return false;
    const deadline = this.deadline;
    try {
      // Forcing sequences are much cheaper to prove than quiet setups. Give
      // them a bounded first pass, reserving most of the budget for broader wins.
      for (const forcingOnly of [true, false]) {
        this.forcingProofMode = forcingOnly;
        this.deadline = forcingOnly ? deadline - Math.max(0, timeLimitMs) * 3 / 4 : deadline;
        // Restricted failures cannot refute quiet setups. Invalidate their
        // depths before broadening; proven wins and independently checked
        // move hints remain useful. Both proof probes require positive depth.
        if (!forcingOnly) this.proofTTDepth.fill(0);
        const limit = Math.min(depthLimit, this.maxPly, forcingOnly ? FORCING_PROOF_MAX_DEPTH : Infinity);
        for (let maxDepth = 1; maxDepth <= limit; maxDepth += 2) {
          try {
            if (this.proofDefend(position, maxDepth, 1)) {
              this.verifiedWinDepth = maxDepth;
              return true;
            }
          } catch (error) {
            if (error !== this.timeoutSignal) throw error;
            if (forcingOnly) break;
            this.timedOut = true;
            return false;
          }
        }
      }
      return false;
    } finally {
      this.forcingProofMode = false;
      this.deadline = deadline;
      position.undo();
    }
  }

  /**
   * Attacker (OR node): try to find at least one forcing move that wins.
   * Includes quiet setup moves when the horizon permits. If any wins, return true.
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
      // A proven win is an exact fact about this position. A failed proof
      // only rules out wins at the same or a smaller search depth.
      if (this.proofTTResult[ttIdx] === 1) return true;
      if (this.proofTTResult[ttIdx] === -1 && this.proofTTDepth[ttIdx] >= depthLeft) return false;
      ttBest = this.proofTTBestMove[ttIdx];
    }

    // Heuristic TT moves are ordering hints only: independently prove the
    // continuation before accepting them, just like dedicated proof TT hints.
    if (ttBest === -1 && this.ttHash[ttIdx] === hash) {
      ttBest = this.ttBestMove[ttIdx];
    }

    // Hash move first: try the TT best move before generating all tactical moves.
    // This skips move generation entirely when the previous iteration's winning move still works.
    if (ttBest !== -1 && this.proveAttackMove(position, ttBest, depthLeft - 1, ply + 1)) {
      this.storeProofTT(ttIdx, hash, depthLeft, 1, ttBest);
      return true;
    }

    // Completing five is legal even in suicide: only occupancy and ko can
    // forbid the point. Recognize it before generating and scoring attacks.
    const winningMove = this.findImmediateWin(position);
    if (winningMove !== -1) {
      this.storeProofTT(ttIdx, hash, depthLeft, 1, winningMove);
      return true;
    }

    // With one attacking turn left, only completing an existing four can win.
    if (depthLeft <= 2) return false;

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    // An attacker facing an immediate counter-win must answer it too. Every
    // other move loses on the defender's next turn; captures and counter-wins
    // are included by the same complete response generator as defense nodes.
    const responses = this.findThreatResponses(position, ply);
    // Longer wins can need quiet setup moves before the forcing sequence.
    // Loss verification keeps a bounded forcing attack set and exhaustive defenses.
    // With at most two attacking turns, a four or tactical capture is needed.
    const forcingOnly = depthLeft <= 4 || this.lossProofMode || this.forcingProofMode;
    let count = responses >= 0 ? responses
      : this.generateTacticalMoves(position, moves, scores, -1, ply, true,
        forcingOnly ? 3 : 2);

    const markBase = ply * this.bufferArea;
    this.proofAttackMarks.fill(0, markBase, markBase + this.bufferArea);
    let usedQuiet = false;
    for (;;) {
      for (let i = 0; i < count; i += 1) {
        const m = moves[i];
        // already tried above
        if (m === ttBest || this.proofAttackMarks[markBase + m] !== 0) continue;
        this.proofAttackMarks[markBase + m] = 1;
        if (this.proveAttackMove(position, m, depthLeft - 1, ply + 1)) {
          this.storeProofTT(ttIdx, hash, depthLeft, 1, m);
          return true;
        }
      }

      if (usedQuiet || responses >= 0 || forcingOnly) break;
      count = this.generateOrderedMoves(position, moves, scores, -1, false, ply);
      usedQuiet = true;
    }

    this.storeProofTT(ttIdx, hash, depthLeft, -1);
    return false;
  }

  /**
   * Defender (AND node): ALL legal moves must fail to refute the attacker's win.
   * Try defenses in stages, returning false as soon as a refutation survives.
   * Loss verification exhausts the full board unless immediate threats suffice.
   */
  private proofDefend(position: GogoPosition, depthLeft: number, ply: number): boolean {
    this.checkTime(false);

    // Opponent (attacker) just made five - attacker wins
    if (position.winner !== EMPTY) return true;
    if (depthLeft <= 1) return false;

    // Proof TT probe
    const hash = position.hash;
    const ttIdx = Number(hash & TT_MASK);
    let ttBest = -1;
    if (this.proofTTHash[ttIdx] === hash) {
      // A proven win is an exact fact about this position. A failed proof
      // only rules out wins at the same or a smaller search depth.
      if (this.proofTTResult[ttIdx] === 1) return true;
      if (this.proofTTResult[ttIdx] === -1 && this.proofTTDepth[ttIdx] >= depthLeft) return false;
      ttBest = this.proofTTBestMove[ttIdx];
    }

    if (ttBest === -1) ttBest = this.killerMoves[ply * 2];

    let anyLegalCount = 0;
    const triedEpoch = this.triedMoveEpoch++;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    const HINTS = 0;
    const THREATS = 1;
    const TACTICAL = 2;
    const NEARBY = 3;
    const FULL_BOARD = 4;

    // Generate each stage only after the preceding defenses fail. All stages
    // share the same legality, refutation, and undo path; epoch marks prevent
    // a defense from being searched twice. Hints can refute before any scoring.
    for (let stage = HINTS; stage <= FULL_BOARD; stage += 1) {
      let count: number;
      switch (stage) {
        case HINTS:
          moves[0] = ttBest;
          moves[1] = this.killerMoves[ply * 2 + 1];
          count = 2;
          break;
        case THREATS:
          count = this.findThreatResponses(position, ply);
          break;
        case TACTICAL:
          count = this.generateOrderedMoves(position, moves, scores, -1, true, ply);
          break;
        case NEARBY:
          count = this.generateOrderedMoves(position, moves, scores, -1, false, ply);
          break;
        default:
          count = this.generateFullBoardMoves(position, moves, scores, -1, false, ply);
      }

      let stageLegalCount = 0;
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (stage === HINTS && (move === -1 || position.board[move] !== EMPTY || move === position.koPoint)) continue;
        if (this.triedMoveMarks[move] === triedEpoch) continue;
        this.triedMoveMarks[move] = triedEpoch;
        if (!position.play(move)) continue;
        anyLegalCount += 1;
        stageLegalCount += 1;
        try {
          if (position.winner !== EMPTY || !this.proofAttack(position, depthLeft - 1, ply + 1)) {
            this.recordKillerMove(ply, move);
            this.storeProofTT(ttIdx, hash, depthLeft, -1, move);
            return false;
          }
        } finally {
          position.undo();
        }
      }

      // Without ko, a nonempty threat-response set is complete: every other
      // move allows an immediate five. Ko requires the broader defense stages.
      if (stage === THREATS && count > 0 && position.koPoint === -1 && anyLegalCount > 0) {
        this.storeProofTT(ttIdx, hash, depthLeft, 1);
        return true;
      }
      // Preserve discovery's nearby-defense shortcut. Loss proofs always
      // include distant defenses; an empty nearby set also needs the full board.
      if (stage === NEARBY && !this.lossProofMode && stageLegalCount !== 0) break;
    }

    // No legal moves → neutral (not proven). Matches search()'s neutral semantics.
    if (anyLegalCount === 0) return false;
    // All defenses exhausted - attacker's win is proven
    this.storeProofTT(ttIdx, hash, depthLeft, 1);
    return true;
  }

  private recordKillerMove(ply: number, move: number): void {
    if (this.killerMoves[ply * 2] !== move) {
      this.killerMoves[ply * 2 + 1] = this.killerMoves[ply * 2];
      this.killerMoves[ply * 2] = move;
    }
  }

  /**
   * Find restricted defender responses when the attacker has an immediate
   * winning threat (open four). Returns the number of response moves written
   * to moveBuffers[ply], or -1 if no immediate threat exists.
   *
   * With immediateOnly, return the first own winning point (or -1), without
   * constructing a response list. Completing five permits suicide; occupancy
   * and ko are checked against the same windows used for threat responses.
   *
   * Response moves include:
   * 1. Blocking cells — empty cells in attacker's four-windows
   * 2. Capture cells — last-liberty cells of attacker groups
   * 3. Own-winning cells — empty cells in defender's four-windows
   *
   * This is sound because any other defender move allows the attacker to
   * complete the four on the next turn.
   */
  private findThreatResponses(position: GogoPosition, ply: number, immediateOnly = false): number {
    const attacker: Player = position.toMove === BLACK ? WHITE : BLACK;
    const defender = position.toMove;
    const meta = position.meta;
    const windows = meta.windows;
    const board = position.board;

    this.beginWindowPass(position);
    const attackerCounts = attacker === BLACK ? this.windowBlack : this.windowWhite;
    const defenderCounts = defender === BLACK ? this.windowBlack : this.windowWhite;

    this.candidateEpoch += 1;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = 0;
    let hasThreat = false;

    // Scan all windows for attacker's open fours and defender's open fours
    for (let word = 0; word < this.activeWindows.length; word += 1) {
      let bits = this.activeWindows[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const wi = word * 32 + 31 - Math.clz32(bit);
        const base = wi * 5;
        const atkCount = attackerCounts[wi];
        const defCount = defenderCounts[wi];
        const threat = atkCount === 4 && defCount === 0;
        const counterWin = defCount === 4 && atkCount === 0;
        if (immediateOnly ? !counterWin : !threat && !counterWin) continue;
        // A qualifying five-cell window has exactly one empty point.
        let emptyCell = -1;
        for (let j = 0; j < 5; j += 1) {
          if (board[windows[base + j]] !== EMPTY) continue;
          emptyCell = windows[base + j];
          break;
        }
        if (emptyCell === -1 || emptyCell === position.koPoint) continue;
        if (immediateOnly) return emptyCell;
        if (threat) hasThreat = true;
        count = this.insertOrPromoteMove(moves, scores, count, emptyCell, counterWin ? 3_000_000 : 2_000_000);
      }
    }

    if (!hasThreat) return -1;

    // Capturing a one-liberty attacker group can break the four. Reuse the
    // tactical group traversal, retaining response priorities and stable ties.
    return this.appendGroupTacticalMoves(position, attacker, ply, count);
  }
}
