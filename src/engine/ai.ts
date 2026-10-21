import { BLACK, EMPTY, GogoPosition, otherPlayer, type Player, WHITE } from './gogomoku';
import { insertMoveDescending, sortMovesDescending } from './moveOrdering';

export interface SearchResult {
  move: number;
  score: number;
  /** Deepest completed root move; a timed-out iteration may be partial. */
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

/** Neutral result defaults; every search exit overrides only established facts. */
const SEARCH_RESULT_DEFAULTS: Readonly<SearchResult> = {
  move: -1,
  score: 0,
  depth: 0,
  nodes: 0,
  timedOut: false,
  forcedDefensiveMove: false,
  forcedWin: false,
  forcedLoss: false,
  heuristicWin: false,
  heuristicLoss: false,
};

interface SearchState {
  bestMove: number;
  bestScore: number;
  completedDepth: number;
  hintMove: number;
  provenWin?: boolean;
  provenLoss?: boolean;
  partial?: boolean;
}

const WIN_SCORE = 1_000_000_000;
const ATTACK_WEIGHTS = [0, 12, 72, 540, 100_000, 500_000] as const;
const DEFENSE_WEIGHTS = [0, 16, 96, 720, 100_000, 500_000] as const;
const EVAL_WEIGHTS = [0, 6, 32, 240, 500_000, WIN_SCORE >> 2] as const;
// Calibrated on independent random-opening self-play; shared by timed searches.
const SHORT_EVAL_WEIGHTS = [0, -106, 48, 624, 500_000, WIN_SCORE >> 2] as const;
const LOCAL_LIBERTY_WEIGHTS = [-200, -80, 20, 60, 80] as const;
const SHORT_LIBERTY_WEIGHTS = [583, 313, 333, 335, 232] as const;
const CAPTURE_GAP_WEIGHT = 480;
// Two bits per neighbor: border=0, empty=1, black=2, white=3.
// Precompute local geometry so leaf evaluation only needs four reads and a lookup.
const CAPTURE_GAP_SCORES = new Int16Array(256);
for (let code = 0; code < 256; code += 1) {
  const cells = [code & 3, (code >> 2) & 3, (code >> 4) & 3, code >> 6];
  for (let axis = 0; axis < 4; axis += 2) {
    const color = cells[axis];
    if (color < 2 || cells[axis + 1] !== color) continue;
    const perpendicular = axis ^ 2;
    const first = cells[perpendicular];
    const second = cells[perpendicular + 1];
    const opponent = 5 - color;
    if (first === opponent || second === opponent) continue;
    const supports = Number(first === 0 || first === color) + Number(second === 0 || second === color);
    // One gap is one threat, even when both axes qualify.
    CAPTURE_GAP_SCORES[code] = (color === 2 ? 1 : -1) * Number(supports > 0) * CAPTURE_GAP_WEIGHT;
  }
}
const TACTICAL_PATTERN_THRESHOLD = ATTACK_WEIGHTS[4];
const CENTER_MULTIPLIER = 0.9; // edge moves are better (see puzzles)
const HINT_BONUS = 10_000_000;
const HISTORY_SCALE = 1;
const KILLER_BONUS = 1_000;
const CAPTURE_BONUS = 5_000;
const ESCAPE_BONUS = 3_500;
const NO_SCORE = Number.NEGATIVE_INFINITY;
const MAX_CANDIDATES = 12;
// Preserve shallow discovery and its proof candidates before pruning more deeply.
const SELECTIVE_SEARCH_MIN_DEPTH = 6;
const SHALLOW_PROOF_NODES_PER_DEPTH = 4096;
const FORCING_PROOF_MAX_DEPTH = 9;
const SHARED_PROOF_HORIZON = 4;
const LOSS_PROOF_NODES_PER_DEPTH = 16384;
const ROOT_PROOF_NODE_LIMIT = 8_000_000;
const ROOT_PROOF_MIN_REMAINING_MS = 5_000;
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
const WINDOW_BLACK_COUNTS = new Uint8Array(36);
const WINDOW_WHITE_COUNTS = new Uint8Array(36);
for (let code = 0; code < 36; code += 1) {
  WINDOW_BLACK_COUNTS[code] = Math.floor(code / 6);
  WINDOW_WHITE_COUNTS[code] = code % 6;
}
const WINDOW_EVALUATION = new Int32Array(36);
const SHORT_WINDOW_EVALUATION = new Int32Array(36);
for (let count = 1; count <= 5; count += 1) {
  WINDOW_EVALUATION[count * 6] = EVAL_WEIGHTS[count];
  WINDOW_EVALUATION[count] = -EVAL_WEIGHTS[count];
  SHORT_WINDOW_EVALUATION[count * 6] = SHORT_EVAL_WEIGHTS[count];
  SHORT_WINDOW_EVALUATION[count] = -SHORT_EVAL_WEIGHTS[count];
}

// Rank timed moves by the window change used by the playing evaluation.
// Tactical membership continues to use the independent pattern classification.
const SHORT_MOVE_BLACK = new Int32Array(36);
const SHORT_MOVE_WHITE = new Int32Array(36);
for (let black = 0; black <= 4; black += 1) {
  for (let white = 0; white <= 4 - black; white += 1) {
    const code = black * 6 + white;
    SHORT_MOVE_BLACK[code] = SHORT_WINDOW_EVALUATION[code + 6] - SHORT_WINDOW_EVALUATION[code];
    SHORT_MOVE_WHITE[code] = SHORT_WINDOW_EVALUATION[code] - SHORT_WINDOW_EVALUATION[code + 1];
  }
}

// Classify counts once; update tactical bitsets only when membership changes.
const WINDOW_CLASSIFICATION = new Uint8Array(36);
for (let count = 2; count <= 5; count += 1) {
  WINDOW_CLASSIFICATION[count * 6] = 1;
  WINDOW_CLASSIFICATION[count] = 1;
}
WINDOW_CLASSIFICATION[4 * 6] = 3;
WINDOW_CLASSIFICATION[4] = 3;

// Each board edit changes a window code by at most six. Pack its evaluation
// delta and classification changes into one lookup in the incremental hot loop.
const windowTransitions = (weights: Int32Array): Int32Array[] => Array.from({ length: 13 }, (_, change) => {
  const transitions = new Int32Array(36);
  for (let oldCode = 0; oldCode < 36; oldCode += 1) {
    const code = oldCode + change - 6;
    if (code >= 0 && code < 36) {
      transitions[oldCode] = (weights[code] - weights[oldCode]) * 4
        + (WINDOW_CLASSIFICATION[oldCode] ^ WINDOW_CLASSIFICATION[code]);
    }
  }
  return transitions;
});
const WINDOW_TRANSITIONS = windowTransitions(WINDOW_EVALUATION);
const SHORT_WINDOW_TRANSITIONS = windowTransitions(SHORT_WINDOW_EVALUATION);

// Transposition table constants
const TT_SIZE_BITS = 18;
const TT_SIZE = 1 << TT_SIZE_BITS;
const QTT_SIZE_BITS = 16;
const QTT_SIZE = 1 << QTT_SIZE_BITS;
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
  // Ascending bit scans retain the stable board order used by tactical scoring.
  private tacticalCandidates = new Uint32Array(0);
  // A descendant must not overwrite its parent's defense deduplication marks.
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
  private directLiberties = new Uint8Array(0);
  // One code (black * 6 + white) feeds classifications, patterns and evaluation.
  private windowCounts = new Uint8Array(0);
  private activeWindows = new Uint32Array(0);
  private occupiedPoints = new Uint32Array(0);
  private winningWindows = new Uint32Array(0);
  private windowHash = -1n;
  private windowPosition: GogoPosition | null = null;
  private windowVersion = 0;
  private evaluationPosition: GogoPosition | null = null;
  private evaluationVersion = 0;
  private windowEvaluation = 0;
  private evaluationBoard = new Uint8Array(0);
  private localScores = new Int32Array(0);
  private localEvaluation = 0;
  private pointPatternBlack = new Float64Array(0);
  private pointPatternWhite = new Float64Array(0);
  private patternsReady = false;
  private patternsCalibrated = false;
  private proofOrdering = false;
  private patternDirty = new Uint8Array(0);
  private dirtyWindows = new Int16Array(0);
  private patternCodes = new Uint8Array(0);
  private dirtyWindowCount = 0;
  private bufferArea = 0;
  private deadline = 0;
  private forcingQuiescence = true;
  private nodesVisited = 0;
  private rootProofMoves = new Int16Array(MAX_CANDIDATES);
  private rootProofScores = new Float64Array(MAX_CANDIDATES);
  private rootProofCount = 0;
  private timedOut = false;
  private fallbackWins = false;
  private killerMoves = new Int16Array(0);
  private readonly timeoutSignal = new Error('SEARCH_TIMEOUT');
  private proofMode = false;
  private reuseProofCache = false;
  private lossProofMode = false;
  private forcingProofMode = false;
  private verifiedWinDepth = 0;
  private proofNodeLimit = Infinity;
  private partialRoot = { move: -1, score: -WIN_SCORE, depth: 0 };
  private selectiveSearch = false;
  private shortEvaluation = false;

  // Transposition table
  private qHash = new BigUint64Array(QTT_SIZE);
  private qScore = new Float64Array(QTT_SIZE);
  private qDepth = new Int16Array(QTT_SIZE);
  private qPlyLeft = new Int32Array(QTT_SIZE);
  private qFlag = new Uint8Array(QTT_SIZE);

  private ttHash = new BigUint64Array(TT_SIZE);
  private ttScore = new Float64Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Uint8Array(TT_SIZE);
  private ttBestMove = new Int16Array(TT_SIZE);

  constructor(options: GogoAIOptions = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 6);
    this.quiescenceDepth = Math.max(0, options.quiescenceDepth ?? 4);
    this.maxPly = Math.max(2, options.maxPly ?? 64);
    this.now = options.now ?? (() => performance.now());
  }

  findBestMove(position: GogoPosition, timeLimitMs: number): SearchResult {
    this.ensureBuffers(position.area);
    this.configureEvaluation(position, timeLimitMs);
    this.windowHash = -1n;
    this.windowPosition = null;
    this.evaluationPosition = null;
    if (!this.forcingQuiescence) {
      this.ttFlag.fill(0);
      this.resetLocalEvaluation();
    }
    this.forcingQuiescence = true;
    this.resetMoveOrdering();
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;
    this.proofMode = false;

    if (position.winner !== EMPTY) {
      return {
        ...SEARCH_RESULT_DEFAULTS,
        score: -WIN_SCORE,
        forcedLoss: true,
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
        ...SEARCH_RESULT_DEFAULTS,
        move: fallbackMove,
        timedOut: fallbackMove !== -1,
      };
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
      return {
        ...SEARCH_RESULT_DEFAULTS,
        move: timedOut ? fallbackMove : forcedDefensiveMove,
        timedOut,
        forcedDefensiveMove: !timedOut,
      };
    }
    // === Phase 1: Heuristic Discovery ===
    // Use NMP, LMR, and candidate capping for fast search.
    // Short move budgets prioritize discovery over speculative proofs. Final
    // heuristic mate claims still require independent verification below.
    if (timeLimitMs >= 100) {
      this.searchDiscoveryWithProofs(position, state);
    } else {
      this.searchDiscoveryOnly(position, state);
    }

    if (state.provenWin || state.provenLoss) {
      return {
        ...SEARCH_RESULT_DEFAULTS,
        move: state.bestMove,
        score: state.bestScore,
        depth: state.completedDepth,
        nodes: this.nodesVisited,
        timedOut: this.timedOut,
        forcedWin: !!state.provenWin,
        forcedLoss: !!state.provenLoss,
        heuristicLoss: !!state.provenLoss,
      };
    }

    const heuristicWin = this.isHeuristicWinScore(state.bestScore, state.completedDepth);
    const heuristicLoss = !state.partial && this.isForcedLossScore(state.bestScore, state.completedDepth);
    let provenWin = false;
    let provenLoss = false;

    // === Phase 2: Proof ===
    // When the heuristic search found a forced outcome, verify with exact search.
    // For wins: use AND/OR threat-space prover (fast for tactical wins).
    // For losses: verify an opponent win after every legal defense.
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
        this.clearSearchHeuristicsAndTables();
        this.resumeDiscoveryDepths(position, state.completedDepth + 1, state);
      }
    }

    // Recompute heuristic flags in case resume changed bestScore/completedDepth
    const finalHeuristicWin = this.isHeuristicWinScore(state.bestScore, state.completedDepth);
    const finalHeuristicLoss = !state.partial && this.isForcedLossScore(state.bestScore, state.completedDepth);

    return {
      ...SEARCH_RESULT_DEFAULTS,
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
    this.windowPosition = null;
    this.evaluationPosition = null;
    this.windowBoard = new Uint8Array(area);
    this.occupiedPoints = new Uint32Array(Math.ceil(area / 32));
    this.windowCounts = new Uint8Array(4 * area);
    const size = Math.sqrt(area);
    this.directLiberties = new Uint8Array(area);
    for (let point = 0; point < area; point += 1) {
      const x = point % size;
      const y = Math.floor(point / size);
      this.directLiberties[point] = Number(x > 0) + Number(x + 1 < size)
        + Number(y > 0) + Number(y + 1 < size);
    }
    this.activeWindows = new Uint32Array(Math.ceil((size - 4) * (4 * size - 8) / 32));
    this.winningWindows = new Uint32Array(this.activeWindows.length);
    this.windowEvaluation = 0;
    this.evaluationBoard = new Uint8Array(area);
    this.localScores = new Int32Array(area);
    this.localEvaluation = 0;
    this.pointPatternBlack = new Float64Array(area);
    this.pointPatternWhite = new Float64Array(area);
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
    this.tacticalCandidates = new Uint32Array(Math.ceil(area / 32));
    this.candidateEpoch = 1;
    this.triedMoveMarks = new Uint32Array(area * (this.maxPly + 1));
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

  private clearSearchHeuristicsAndTables(): void {
    return this.resetSearchHeuristics(true);
  }

  private resetMoveOrdering(): void {
    return this.resetSearchHeuristics(false);
  }

  private resetSearchHeuristics(clearTT = false): void {
    this.history.fill(0);
    this.killerMoves.fill(-1);
    if (clearTT) {
      this.ttFlag.fill(0);
      this.qFlag.fill(0);
    }
  }

  private searchDiscoveryWithProofs(position: GogoPosition, state: SearchState): void {
    return this.searchDepths(position, 1, state, this.maxDepth, true);
  }

  private searchDiscoveryOnly(position: GogoPosition, state: SearchState): void {
    return this.searchDepths(position, 1, state, this.maxDepth, false);
  }

  private resumeDiscoveryDepths(position: GogoPosition, startDepth: number, state: SearchState): void {
    return this.searchDepths(position, startDepth, state);
  }

  private searchDepths(position: GogoPosition, startDepth: number, state: SearchState, endDepth = this.maxDepth, earlyProof = false): void {
    let earlyProofTried = false;
    let shallowProofTried = false;
    let earlyLossTried = false;
    let rootProofTried = false;
    for (let depth = startDepth; depth <= endDepth; depth += 1) {
      this.partialRoot.move = -1;
      try {
        const result = this.searchRoot(position, depth, state.hintMove);
        if (result.move === -1) {
          continue;
        }
        const previousPromisingMove = state.bestScore >= ATTACK_WEIGHTS[2] ? state.bestMove : -1;
        const stableRootMove = result.move === state.bestMove;
        state.bestMove = result.move;
        state.bestScore = result.score;
        state.completedDepth = depth;
        delete state.partial;
        state.hintMove = result.move;
        if (this.isHeuristicWinScore(result.score, depth) || this.isForcedLossScore(result.score, depth)) {
          break;
        }
        if (!earlyProof) continue;
        const sustainedLoss = depth >= 6 && result.score <= -EVAL_WEIGHTS[2] * 4;
        const lossDepth = sustainedLoss ? depth * 2 + 1 : depth + 3;
        const lossCandidate = sustainedLoss || result.score <= -EVAL_WEIGHTS[4];
        if (!earlyLossTried && depth >= 3 && lossDepth <= Math.min(endDepth, this.maxPly) && lossCandidate) {
          earlyLossTried = true;
          if (this.tryEarlyLossProof(position, state, LOSS_PROOF_NODES_PER_DEPTH * this.maxDepth, lossDepth)) break;
        }
        // Expensive first iterations and sparse openings need another look
        // before speculative proof. Cheap tactical setups can be proved now.
        // A failed probe applies to its candidate, not a revised root leader.
        if (!stableRootMove) shallowProofTried = false;
        const shallowProofReady = this.canProbeShallowProof(position, depth, result.nodes);
        if (!shallowProofTried && shallowProofReady && endDepth >= 5 && result.score >= ATTACK_WEIGHTS[2]) {
          shallowProofTried = true;
          const forcing = this.forcingQuiescence;
          if (this.tryEarlyWinProof(position, state, SHALLOW_PROOF_NODES_PER_DEPTH * this.maxDepth, this.maxDepth, true)) break;
          // A changed evaluation gets its own shallow-proof opportunity.
          if (forcing && !this.forcingQuiescence) shallowProofTried = false;
        }
        // A strong tactical candidate often appears before discovery finds its
        // mate score. Try a bounded independent proof at the first promising
        // depth, retaining most of the budget for discovery if it cannot win.
        if (!earlyProofTried && depth >= 3 && depth < endDepth && result.score >= EVAL_WEIGHTS[4] / 2) {
          earlyProofTried = true;
          if (this.tryEarlyWinProof(position, state)) break;
        }
        // Discovery may keep preferring a strong setup without reaching a
        // mate score. Independently verify its best tactical root candidates
        // once deep search is underway, with a fixed node and time budget.
        if (!rootProofTried && depth >= 5 && endDepth >= FORCING_PROOF_MAX_DEPTH + 4
          && result.score < EVAL_WEIGHTS[4] / 2
          && this.deadline - this.now() >= ROOT_PROOF_MIN_REMAINING_MS) {
          rootProofTried = true;
          if (this.tryRootProofPortfolio(position, state, stableRootMove, previousPromisingMove)) break;
        }
      } catch (error) {
        if (error !== this.timeoutSignal) {
          throw error;
        }
        // The preceding leader is searched first, so completed children can
        // be compared at this deeper horizon even when every score fell.
        if (this.partialRoot.move !== -1) {
          state.bestMove = this.partialRoot.move;
          state.bestScore = this.partialRoot.score;
          state.completedDepth = this.partialRoot.depth;
          state.partial = true;
        }
        this.timedOut = true;
        break;
      }
    }
  }

  private tryRootProofPortfolio(position: GogoPosition, state: SearchState, stableRootMove: boolean, previousPromisingMove = -1): boolean {
    // All candidates share the same attacker and full proof rules. Completed
    // bounds and proven subpositions remain valid across this entire batch.
    this.clearProofTable();
    this.reuseProofCache = true;
    // Keep a stable discovery leader first; use the preceding horizon's node
    // count to estimate proof cost for the other candidates.
    const costs = new Float64Array(MAX_CANDIDATES);
    try {
      // An odd/even horizon can demote a promising setup below the proof beam.
      // Preserve that witness before spending the budget on newly ranked moves.
      if (previousPromisingMove !== -1 && previousPromisingMove !== state.bestMove) {
        const probe = { ...state, bestMove: previousPromisingMove, hintMove: previousPromisingMove };
        if (this.tryEarlyWinProof(position, probe, ROOT_PROOF_NODE_LIMIT, this.maxDepth)) {
          Object.assign(state, probe);
          return true;
        }
      }
      for (let depthLimit = 1; ; depthLimit = Math.min(depthLimit + 2, this.maxDepth)) {
        for (let i = 0; i < this.rootProofCount; i += 1) {
          if (this.now() >= this.deadline) return false;
          const move = this.rootProofMoves[i];
          const probe = { ...state, bestMove: move, hintMove: move };
          const nodes = this.nodesVisited;
          const horizon = stableRootMove && i === 0 ? this.maxDepth : depthLimit;
          if (this.tryEarlyWinProof(position, probe, ROOT_PROOF_NODE_LIMIT, horizon)) {
            Object.assign(state, probe);
            return true;
          }
          costs[i] = stableRootMove && i === 0 ? Infinity : -(this.nodesVisited - nodes);
        }
        sortMovesDescending(this.rootProofMoves, costs, this.rootProofCount);
        if (depthLimit >= this.maxDepth) break;
      }
      return false;
    } finally {
      this.reuseProofCache = false;
    }
  }

  private canProbeShallowProof(position: GogoPosition, depth: number, nodes: number): boolean {
    // Reserve first-iteration probes for cheap tactical candidates. The
    // calibrated evaluation can make an unstable first choice look promising.
    return depth >= 2 || (position.stoneCount >= 5 && nodes <= (this.shortEvaluation ? 256 : 1024));
  }

  /** Speculative win/loss probes share budget and heuristic restoration. */
  private tryEarlyWinProof(position: GogoPosition, state: SearchState, nodeLimit?: number, depthLimit = this.maxDepth, reserveDiscovery = false): boolean {
    // Calibrated play reserves time inside its classic scout. That scout must
    // not halve the same allowance again while verifying its own candidates.
    if (!reserveDiscovery || this.shortEvaluation || !this.forcingQuiescence) {
      return this.tryWinProofWithDiscovery(position, state, nodeLimit, depthLimit);
    }
    // Node quotas grow with the configured horizon, but shallow speculation
    // must also leave time to improve the move when its proof is inconclusive.
    const deadline = this.deadline;
    const now = this.now();
    this.deadline = now + Math.max(0, deadline - now) / 2;
    try {
      return this.tryWinProofWithDiscovery(position, state, nodeLimit, depthLimit);
    } finally {
      this.deadline = deadline;
      this.timedOut = this.now() >= deadline;
    }
  }

  private tryWinProofWithDiscovery(position: GogoPosition, state: SearchState, nodeLimit: number | undefined, depthLimit: number): boolean {
    // Give one candidate the average discovery work per root candidate.
    // A revised candidate retains the caller's full proof allowance.
    const probeLimit = this.forcingQuiescence
      ? Math.min(nodeLimit ?? Infinity, Math.ceil(this.nodesVisited / Math.max(1, this.rootProofCount)))
      : nodeLimit;
    const proven = this.tryEarlyProof(position, state, probeLimit, 0, depthLimit);
    if (!proven && this.forcingQuiescence && !this.timedOut) {
      if (this.shortEvaluation) return this.tryClassicProofScout(position, state, nodeLimit, depthLimit);
      // If a forcing candidate cannot be established, rediscover at the same
      // depth with quiet defensive setups before probing the revised candidate.
      const depth = state.completedDepth;
      this.forcingQuiescence = false;
      // Diversify setup candidates with the baseline local evaluation too.
      this.resetLocalEvaluation();
      this.clearSearchHeuristicsAndTables();
      this.ttBestMove.fill(-1); // Rebuild ordering as well as score bounds.
      const fallback = this.pickFallbackMove(position);
      state.bestMove = fallback;
      state.bestScore = 0;
      state.completedDepth = 0;
      state.hintMove = fallback;
      const nodes = this.nodesVisited;
      this.searchDepths(position, 1, state, depth);
      if (!this.timedOut && this.canProbeShallowProof(position, state.completedDepth, this.nodesVisited - nodes)
        && state.bestScore >= ATTACK_WEIGHTS[2]) return this.tryEarlyProof(position, state, nodeLimit, 0, depthLimit);
    }
    return proven;
  }

  /** Classic discovery supplies exact witnesses without replacing calibrated play. */
  private tryClassicProofScout(position: GogoPosition, state: SearchState, nodeLimit: number | undefined, depthLimit: number): boolean {
    if (nodeLimit === 0) return false;
    const scout = { ...state };
    const deadline = this.deadline;
    const now = this.now();
    // Classic scores and ordering belong to their own search. An inconclusive
    // scout must leave the calibrated TT, quiescence cache and heuristics usable
    // when discovery resumes, including after a scout timeout or exception.
    const classic = new GogoAI({ maxDepth: this.maxDepth, quiescenceDepth: this.quiescenceDepth, maxPly: this.maxPly, now: this.now });
    classic.ensureBuffers(position.area);
    classic.deadline = now + Math.max(0, deadline - now) / 2;
    classic.forcingQuiescence = false;
    classic.ttBestMove.fill(-1);
    classic.nodesVisited = this.nodesVisited;
    try {
      const fallback = classic.pickFallbackMove(position);
      Object.assign(scout, { bestMove: fallback, bestScore: 0, completedDepth: 0, hintMove: fallback });
      classic.searchDepths(position, 1, scout, depthLimit, true);
      let resolved = !!(scout.provenWin || scout.provenLoss);
      if (!resolved && !classic.timedOut && scout.bestScore >= ATTACK_WEIGHTS[2]) {
        // As in normal discovery, a mate score warrants exact verification
        // within the scout's deadline rather than a speculative node quota.
        const proofLimit = classic.isHeuristicWinScore(scout.bestScore, scout.completedDepth)
          ? undefined : SHALLOW_PROOF_NODES_PER_DEPTH * this.maxDepth;
        resolved = classic.tryEarlyProof(position, scout, proofLimit, 0, depthLimit);
      }
      if (resolved) Object.assign(state, scout);
      return resolved;
    } finally {
      this.nodesVisited = classic.nodesVisited;
      this.timedOut = this.now() >= deadline;
    }
  }

  private tryEarlyLossProof(position: GogoPosition, state: SearchState, nodeLimit: number, lossDepth: number): boolean {
    let proofState = state;
    if (this.shortEvaluation && nodeLimit > 0) {
      // Prove the hardest classic defense first, without replacing calibrated
      // play or overwriting its useful continuation hints with ordering work.
      const ordering = new GogoAI({ maxDepth: 2, quiescenceDepth: this.quiescenceDepth, maxPly: this.maxPly, now: this.now });
      ordering.ensureBuffers(position.area);
      ordering.deadline = this.deadline;
      proofState = { ...state, bestScore: 0, completedDepth: 0, hintMove: -1 };
      ordering.searchDepths(position, 1, proofState, 2);
      this.nodesVisited += ordering.nodesVisited;
      if (ordering.timedOut) {
        this.timedOut = true;
        return false;
      }
    }
    const proven = this.tryEarlyProof(position, proofState, nodeLimit, lossDepth);
    if (proven) Object.assign(state, proofState);
    return proven;
  }

  private tryEarlyProof(position: GogoPosition, state: SearchState, nodeLimit = Infinity, lossDepth = 0, depthLimit = this.maxDepth): boolean {
    const deadline = this.deadline;
    const previousOrdering = this.proofOrdering;
    this.proofOrdering = true;
    // Winning-move verification starts its own node counter; loss verification
    // adds to discovery's counter. Restore accounting according to that API.
    const nodes = lossDepth === 0 ? this.nodesVisited : 0;
    const previousNodeLimit = this.proofNodeLimit;
    this.proofNodeLimit = nodeLimit;
    const history = this.history.slice();
    const killers = this.killerMoves.slice();
    try {
      if (lossDepth !== 0) {
        this.deadline = Number.isFinite(nodeLimit) ? deadline : this.now() + (deadline - this.now()) / 4;
        this.proofNodeLimit = this.nodesVisited + nodeLimit;
        const score = this.proofSearchRoot(position, lossDepth, state.bestMove);
        if (!this.isForcedLossScore(score, lossDepth)) return false;
        state.bestScore = score;
        state.completedDepth = lossDepth;
        state.provenLoss = true;
        return true;
      }
      // Finite work quotas already bound speculation. Let those proofs use
      // the overall deadline instead of abandoning them at a time fraction.
      const proofBudget = (deadline - this.now()) / (Number.isFinite(nodeLimit) ? 1 : 4);
      if (!this.verifyWinningMove(position, state.bestMove, proofBudget, depthLimit)) {
        if (this.timedOut) return false;
        // The heuristic's first choice can hide a winning quiet setup. Probe
        // alternatives with an independent bounded root proof before spending
        // the remaining budget on deeper heuristic iterations.
        this.proofNodeLimit = this.nodesVisited + nodeLimit;
        this.resetProofSearch();
        const depth = Math.min(depthLimit, FORCING_PROOF_MAX_DEPTH);
        if (!this.proofAttack(position, depth, 0)) return false;
        state.bestMove = this.proofTTBestMove[Number(BigInt.asUintN(TT_SIZE_BITS, position.hash))];
        state.hintMove = state.bestMove;
        this.verifiedWinDepth = depth;
      }
      state.bestScore = WIN_SCORE - this.verifiedWinDepth;
      state.completedDepth = this.verifiedWinDepth;
      state.provenWin = true;
      return true;
    } catch (error) {
      if (error !== this.timeoutSignal) throw error;
      return false;
    } finally {
      this.proofOrdering = previousOrdering;
      this.deadline = deadline;
      this.proofNodeLimit = previousNodeLimit;
      this.nodesVisited += nodes;
      this.history.set(history);
      this.killerMoves.set(killers);
      this.timedOut = this.now() >= deadline;
    }
  }

  /** Include the winning move detected just beyond the tactical horizon. */
  private isHeuristicWinScore(score: number, depth: number): boolean {
    return this.isForcedWinScore(score, Math.min(this.maxPly, depth + this.quiescenceDepth + 1));
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
    this.beginWindowPass(position);
    const winningCode = position.toMove === BLACK ? 24 : 4;
    for (let word = 0; word < this.winningWindows.length; word += 1) {
      let bits = this.winningWindows[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const wi = word * 32 + 31 - Math.clz32(bit);
        if (this.windowCounts[wi] !== winningCode) continue;
        for (let offset = 0; offset < 5; offset += 1) {
          const point = position.meta.windows[wi * 5 + offset];
          // Completing five is legal even in suicide; only occupancy and ko matter.
          if (position.board[point] === EMPTY && point !== position.koPoint) return point;
        }
      }
    }
    return -1;
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
        ? this.generateNearbyMoves(position, moves, scores, -1)
        : this.generateAllBoardMoves(position, moves, scores, -1);
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
    const previous = this.proofOrdering;
    this.proofOrdering = true;
    try {
      return this.searchLossProof(position, depth, hintMove);
    } finally {
      this.proofOrdering = previous;
    }
  }

  private searchLossProof(position: GogoPosition, depth: number, hintMove: number): number {
    this.checkTimeNow();
    const count = this.generateAllBoardMoves(position, this.moveBuffers[0], this.scoreBuffers[0], hintMove);
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
        this.checkTimeNow();
        if (!position.play(defense)) continue;
        legalCount++;
        try {
          if (position.winner !== EMPTY) return 0;
          // Reuse the attacker prover for the concrete reply search. Its hash
          // hint and the last successful reply are independently checked before
          // generating alternatives; neither discovery scores nor hints prove a win.
          // Find a short winning witness before exploring longer forcing lines.
          // Failed shallow probes remain valid bounds in the dedicated proof TT.
          let provenReply = false;
          for (let replyDepth = 1; replyDepth <= depth; replyDepth += 2) {
            if (this.proofAttack(position, replyDepth, 1, winningReply)) {
              provenReply = true;
              break;
            }
          }
          if (provenReply) {
            winningReply = this.proofTTBestMove[Number(BigInt.asUintN(TT_SIZE_BITS, position.hash))];
            continue;
          }
          this.proofMode = false;
          const state: SearchState = {
            bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1,
          };
          this.searchDepths(position, 1, state, depth - 1);
          if (!this.isForcedWinScore(state.bestScore, state.completedDepth)) return 0;
          this.checkTimeNow();
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

  private searchRoot(position: GogoPosition, depth: number, hintMove: number): SearchResult {
    this.checkTimeNow();
    // Sparse openings need candidate diversity before local ordering is reliable.
    this.selectiveSearch = depth >= SELECTIVE_SEARCH_MIN_DEPTH && position.stoneCount >= 3;
    const beta = WIN_SCORE;
    const moves = this.moveBuffers[0];
    const scores = this.scoreBuffers[0];

    let alpha = -WIN_SCORE;
    let bestMove = -1;
    let bestScore = -WIN_SCORE;
    let legalCount = 0;
    this.rootProofCount = 0;

    // Double discovery's root beam each iteration instead of permanently
    // excluding quiet setups. Exact proofs and full-board fallbacks stay complete.
    const rootLimit = MAX_CANDIDATES * 2 ** (depth - 2);
    // Search nearby candidates first, broadening only when none is legal.
    for (let stage = 0; stage < 2; stage += 1) {
      let count = stage === 0
        ? this.generateNearbyMoves(position, moves, scores, hintMove)
        : this.generateAllBoardMoves(position, moves, scores, hintMove);
      // Partial iterations must compare the previous leader at this horizon.
      // Keep it first independently of history and tactical score magnitudes.
      if (moves[0] !== hintMove) {
        for (let index = 1; index < count; index += 1) {
          if (moves[index] !== hintMove) continue;
          const score = scores[index];
          moves.copyWithin(1, 0, index);
          scores.copyWithin(1, 0, index);
          moves[0] = hintMove;
          scores[0] = score;
          break;
        }
      }
      if (stage === 0 && !this.proofMode && depth > 1) count = Math.min(count, rootLimit);
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (!position.play(move)) {
          continue;
        }
        legalCount += 1;
        let score = 0;
        try {
          score = this.searchRootChild(position, depth, alpha, beta, 1, legalCount);
        } finally {
          position.undo();
        }
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
          this.partialRoot.move = move;
          this.partialRoot.score = score;
          this.partialRoot.depth = depth;
        }
        if (score >= ATTACK_WEIGHTS[2]) {
          if (this.rootProofCount < MAX_CANDIDATES) {
            insertMoveDescending(this.rootProofMoves, this.rootProofScores, this.rootProofCount, move, score);
            this.rootProofCount += 1;
          } else if (score > this.rootProofScores[MAX_CANDIDATES - 1]) {
            insertMoveDescending(this.rootProofMoves, this.rootProofScores, MAX_CANDIDATES - 1, move, score);
          }
        }
        if (score > alpha) {
          alpha = score;
        }
        // Discovery needs a winning witness within this iteration's depth.
        // The independent prover verifies it before claiming a forced win.
        // Exact numeric searches still stop only at an immediate win.
        if (alpha >= WIN_SCORE - (this.proofMode ? 1 : depth)) break;
      }
      if (legalCount !== 0) break;
    }

    return {
      ...SEARCH_RESULT_DEFAULTS,
      move: legalCount === 0 ? -1 : bestMove,
      score: legalCount === 0 ? 0 : bestScore,
      depth,
      nodes: this.nodesVisited,
    };
  }

  private searchWithoutNullMove(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number): number {
    return this.search(position, depth, alpha, beta, ply, false);
  }

  private searchWithNullMove(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number): number {
    return this.search(position, depth, alpha, beta, ply, true);
  }

  private search(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, canNullMove = true): number {
    this.checkTimePeriodically();
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }
    if (depth <= 0 || ply >= this.maxPly) {
      return this.quiescence(position, alpha, beta, ply, this.quiescenceDepth);
    }

    const origAlpha = alpha;

    // Transposition table probe
    const hash = position.hash;
    const ttIndex = Number(BigInt.asUintN(TT_SIZE_BITS, hash));
    let ttBest = -1;
    // Extract ordering hints even when the score flag was cleared. Score
    // cutoffs additionally require a valid entry at sufficient depth.
    if (this.ttHash[ttIndex] === hash) {
      ttBest = this.ttBestMove[ttIndex];
      if (this.ttFlag[ttIndex] !== TT_NONE && this.ttDepth[ttIndex] >= depth) {
        const ttFlag = this.ttFlag[ttIndex];
        const ttScore = this.adjustMateScore(this.ttScore[ttIndex], -ply);
        if (ttFlag === TT_EXACT) return ttScore;
        if (ttFlag === TT_LOWERBOUND && ttScore >= beta) return ttScore;
        if (ttFlag === TT_UPPERBOUND && ttScore <= alpha) return ttScore;
      }
    }

    // A shallow node with a comfortable static surplus rarely needs a full
    // quiet subtree. Keep mate scores and either side's immediate threats on
    // the ordinary search path; exact searches never use this heuristic.
    if (!this.proofMode && this.selectiveSearch && depth <= 2
      && Math.abs(beta) < WIN_SCORE - this.maxPly
      && this.evaluate(position) >= beta + 240 * depth
      && this.findThreatResponses(position, ply) < 0 && this.findImmediateWin(position) === -1) {
      this.ttHash[ttIndex] = hash;
      this.ttScore[ttIndex] = beta;
      this.ttDepth[ttIndex] = depth;
      this.ttFlag[ttIndex] = TT_LOWERBOUND;
      this.ttBestMove[ttIndex] = ttBest;
      return beta;
    }

    // Null move pruning: if we give the opponent a free move and they still
    // can't beat beta, the position is likely good enough to prune.
    // Skipped in proof mode because NMP is unsound (can miss forced wins).
    if (depth >= 3 && canNullMove && !this.proofMode && this.evaluate(position) >= beta) {
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
        nullScore = -this.searchWithoutNullMove(position, depth - 1 - R, -beta, -beta + 1, ply + 1);
      } finally {
        position.toMove = savedToMove;
        position.koPoint = savedKo;
        position.hash = savedHash;
      }
      if (nullScore >= beta) {
        return beta;
      }
    }

    const hintMove = ttBest;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    const responses = this.findThreatResponses(position, ply);
    let wasCapped = false;
    let legalCount = 0;
    let bestScore = -WIN_SCORE;
    let bestMove = -1;

    for (let stage = 0; stage < 2; stage += 1) {
      let count: number;
      if (stage === 0) {
        count = responses >= 0 ? responses : this.proofMode
          ? this.generateNearbyMoves(position, moves, scores, hintMove, ply)
          : this.generateBestNearbyMoves(position, moves, scores, hintMove, ply);
      } else {
        count = this.proofMode
          ? this.generateAllBoardMoves(position, moves, scores, hintMove, ply)
          : this.generateBestAllBoardMoves(position, moves, scores, hintMove, ply);
      }
      if (!this.proofMode && count > MAX_CANDIDATES) {
        count = MAX_CANDIDATES;
        wasCapped = true;
      }
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        // Scout tails are unlikely to improve alpha after the leading quiet
        // moves fail. Always retain captures, escapes and line threats, and
        // never apply this selective pruning to full-window or exact searches.
        if (!this.proofMode && this.selectiveSearch && depth <= 2 && legalCount >= 3 + depth * depth
          && beta - alpha <= 1 && responses < 0 && scores[i] < ESCAPE_BONUS) {
          wasCapped = true;
          continue;
        }
        if (!position.play(move)) {
          continue;
        }
        legalCount += 1;
        let score = 0;
        try {
          score = this.searchInteriorChild(position, depth, alpha, beta, ply + 1, legalCount);
        } finally {
          position.undo();
        }
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score <= alpha) continue;
        alpha = score;
        if (alpha >= beta) {
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

    // Transposition table store
    // An in-window result from the searched candidates remains a lower
    // bound when other candidates were omitted. Fail-low scores are upper
    // bounds on searched moves and cannot establish a capped-node bound.
    const storeFlag = bestScore <= origAlpha ? TT_UPPERBOUND
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
  private searchRootChild(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, legalCount: number): number {
    return this.searchChild(position, depth, alpha, beta, ply, legalCount, true);
  }

  private searchInteriorChild(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, legalCount: number): number {
    return this.searchChild(position, depth, alpha, beta, ply, legalCount, false);
  }

  private searchChild(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, legalCount: number, root = false): number {
    if (legalCount === 1 || (root && depth < 4)) {
      return -this.searchWithNullMove(position, depth - 1, -beta, -alpha, ply);
    }
    let searchDepth = depth - 1;
    // LMR is heuristic and remains disabled in exact numeric searches.
    if (!root && !this.proofMode && depth >= 3 && legalCount > 3) {
      const reduction = this.selectiveSearch
        ? 1 + Math.floor(Math.log(depth) * Math.log(legalCount) / 2)
        : 1;
      searchDepth = Math.max(1, searchDepth - reduction);
    }
    let score = -this.searchWithNullMove(position, searchDepth, -alpha - 1, -alpha, ply);
    if (searchDepth < depth - 1 && score > alpha) {
      score = -this.searchWithNullMove(position, depth - 1, -alpha - 1, -alpha, ply);
    }
    if (score > alpha && score < beta) {
      score = -this.searchWithNullMove(position, depth - 1, -beta, -alpha, ply);
    }
    return score;
  }

  private quiescence(position: GogoPosition, alpha: number, beta: number, ply: number, remainingDepth: number): number {
    this.checkTimePeriodically();
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }

    const hash = position.hash;
    const index = this.selectiveSearch
      ? Number(BigInt.asUintN(QTT_SIZE_BITS, hash))
      : Number(BigInt.asUintN(12, hash));
    const searchDepth = Math.min(remainingDepth, this.maxPly - ply);
    // Forcing discovery and broadened discovery can have different values.
    // Tag their entries instead of discarding quiescence caches.
    const cacheDepth = this.forcingQuiescence ? -searchDepth - 1 : searchDepth;
    const originalAlpha = alpha;
    if (this.qHash[index] === hash && this.qDepth[index] === cacheDepth
      && (!this.forcingQuiescence || this.qPlyLeft[index] === this.maxPly - ply)) {
      const cached = this.adjustMateScore(this.qScore[index], -ply);
      const flag = this.qFlag[index];
      if (flag === TT_EXACT || (flag === TT_LOWERBOUND && cached >= beta) || (flag === TT_UPPERBOUND && cached <= alpha)) return cached;
    }
    const store = (score: number): number => {
      this.qHash[index] = hash;
      this.qDepth[index] = cacheDepth;
      this.qPlyLeft[index] = this.maxPly - ply;
      this.qScore[index] = this.adjustMateScore(score, ply);
      this.qFlag[index] = score >= beta ? TT_LOWERBOUND : score <= originalAlpha ? TT_UPPERBOUND : TT_EXACT;
      return score;
    };

    const standPat = this.evaluate(position);
    if (ply >= this.maxPly) return store(standPat);
    // A large positive static score suggests an own four. Confirm its legality
    // exactly before avoiding tactical generation; smaller scores take the
    // normal path without an extra window scan.
    if ((remainingDepth > 0 || (this.forcingQuiescence && this.quiescenceDepth > 0))
      && standPat >= EVAL_WEIGHTS[4] / 2 && this.findImmediateWin(position) !== -1) {
      return store(WIN_SCORE - ply - 1);
    }
    if (remainingDepth === 0) return store(standPat);

    const responses = this.findThreatResponses(position, ply);
    if (responses < 0 && standPat >= beta) {
      return store(standPat);
    }
    if (responses < 0 && standPat > alpha) {
      alpha = standPat;
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    // Start with attacks and captures. An unsuccessful proof probe broadens
    // discovery to defensive setups; immediate wins always require all replies.
    const count = responses >= 0 ? responses : this.forcingQuiescence
      ? this.generateAttackingMoves(position, moves, scores, -1, ply)
      : this.generateNearbyTacticalMoves(position, moves, scores, -1);
    if (count === 0) {
      return store(standPat);
    }

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
        // Forcing discovery retains its attack allowance through a unique
        // reply. Broader setup scouts keep their independent fixed horizon.
        score = -this.quiescence(position, -beta, -alpha, ply + 1, remainingDepth - (this.forcingQuiescence && responses === 1 ? 0 : 1));
      } finally {
        position.undo();
      }
      if (score > bestScore) {
        bestScore = score;
      }
      if (score <= alpha) continue;
      alpha = score;
      if (alpha >= beta) return store(score);
    }

    // Every move outside a complete response set permits five next turn.
    // An entirely immobile side remains neutral under the game rules.
    if (responses >= 0 && legalCount === 0) {
      return store(position.hasAnyLegalMove() ? -WIN_SCORE + ply + 2 : 0);
    }
    return store(bestScore);
  }

  /** Share incremental five-cell counts across scoring, evaluation and threats. */
  private beginWindowPass(position: GogoPosition): void {
    if (this.windowHash === position.hash) return;
    const board = position.board;
    const meta = position.meta;
    const counts = this.windowCounts;
    const dirty = this.patternDirty;
    const dirtyWindows = this.dirtyWindows;
    const winning = this.winningWindows;
    const active = this.activeWindows;
    const offsets = meta.windowsByPointOffsets;
    const windows = meta.windowsByPoint;
    let dirtyCount = this.dirtyWindowCount;
    let evaluation = this.windowEvaluation;
    const transitionTables = this.shortEvaluation ? SHORT_WINDOW_TRANSITIONS : WINDOW_TRANSITIONS;
    const changes = position.boardVersion - this.windowVersion;
    const incremental = this.windowPosition === position && changes > 0 && changes <= position.boardChanges.length;
    const count = incremental ? changes : position.area;
    for (let index = 0; index < count; index += 1) {
      const point = incremental
        ? position.boardChanges[(this.windowVersion + index) & (position.boardChanges.length - 1)]
        : index;
      const oldCell = this.windowBoard[point];
      const cell = board[point];
      if (cell === oldCell) continue;
      const pointBit = 1 << (point & 31);
      const pointWord = point >>> 5;
      this.occupiedPoints[pointWord] = (this.occupiedPoints[pointWord] & ~pointBit) | (-Number(cell !== EMPTY) & pointBit);
      const countDelta = ((cell & 1) - (oldCell & 1)) * 6 + (cell >> 1) - (oldCell >> 1);
      const transitions = transitionTables[countDelta + 6];
      for (let cursor = offsets[point]; cursor < offsets[point + 1]; cursor += 1) {
        const wi = windows[cursor];
        if (dirty[wi] === 0) {
          dirty[wi] = 1;
          dirtyWindows[dirtyCount++] = wi;
        }
        const oldCode = counts[wi];
        const code = oldCode + countDelta;
        const transition = transitions[oldCode];
        evaluation += transition >> 2;
        counts[wi] = code;
        const changed = transition & 3;
        if (changed !== 0) {
          const bit = 1 << (wi & 31);
          const word = wi >>> 5;
          if (changed & 1) active[word] ^= bit;
          if (changed & 2) winning[word] ^= bit;
        }
      }
      const libertyDelta = Number(oldCell !== EMPTY) - Number(cell !== EMPTY);
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = meta.neighbors4[point * 4 + offset];
        if (neighbor !== -1) this.directLiberties[neighbor] += libertyDelta;
      }
      this.windowBoard[point] = cell;
    }
    this.windowEvaluation = evaluation;
    this.dirtyWindowCount = dirtyCount;
    this.windowHash = position.hash;
    this.windowPosition = position;
    this.windowVersion = position.boardVersion;
  }

  /** Defer point scores until needed; immediate proof nodes only need counts. */
  private beginPatternPass(position: GogoPosition): void {
    this.beginWindowPass(position);
    const meta = position.meta;
    const calibrated = this.shortEvaluation && !this.proofOrdering;
    if (calibrated !== this.patternsCalibrated) {
      this.patternsCalibrated = calibrated;
      this.patternsReady = false;
      this.patternCodes.fill(0);
      this.dirtyWindowCount = meta.windowCount;
      for (let window = 0; window < meta.windowCount; window += 1) {
        this.patternDirty[window] = 1;
        this.dirtyWindows[window] = window;
      }
    }
    const blackWeights = calibrated ? SHORT_MOVE_BLACK : WINDOW_PATTERN_BLACK;
    const whiteWeights = calibrated ? SHORT_MOVE_WHITE : WINDOW_PATTERN_WHITE;
    if (!this.patternsReady) {
      for (let point = 0; point < position.area; point += 1) {
        const baseline = (meta.windowsByPointOffsets[point + 1] - meta.windowsByPointOffsets[point]) * blackWeights[0];
        this.pointPatternBlack[point] = baseline;
        this.pointPatternWhite[point] = baseline;
      }
      this.patternsReady = true;
    }
    for (let index = 0; index < this.dirtyWindowCount; index += 1) {
      const wi = this.dirtyWindows[index];
      const code = this.windowCounts[wi];
      const oldCode = this.patternCodes[wi];
      this.patternCodes[wi] = code;
      this.patternDirty[wi] = 0;
      if (code === oldCode) continue;
      const blackDelta = blackWeights[code] - blackWeights[oldCode];
      const whiteDelta = whiteWeights[code] - whiteWeights[oldCode];
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
    this.beginWindowPass(position);
    const board = position.board;
    const neighbors = position.meta.neighbors4;
    const changes = position.boardVersion - this.evaluationVersion;
    const incremental = this.evaluationPosition === position && changes <= position.boardChanges.length;
    const count = incremental ? changes : position.area;
    for (let index = 0; index < count; index += 1) {
      const point = incremental
        ? position.boardChanges[(this.evaluationVersion + index) & (position.boardChanges.length - 1)]
        : index;
      if (board[point] === this.evaluationBoard[point]) continue;
      this.evaluationBoard[point] = board[point];
      this.updateLocalScore(position, point);
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = neighbors[point * 4 + offset];
        if (neighbor !== -1) this.updateLocalScore(position, neighbor);
      }
    }
    this.evaluationPosition = position;
    this.evaluationVersion = position.boardVersion;
    const score = this.windowEvaluation + this.localEvaluation / 10;
    return (position.toMove === BLACK ? score : -score) + (this.shortEvaluation ? 1135 : 0);
  }

  /** Keep timed searches on one objective; invalidate scores when the policy changes. */
  private configureEvaluation(position: GogoPosition, timeLimitMs: number): void {
    // More time must deepen the same evaluation, rather than restore weaker weights.
    const short = timeLimitMs > 0 && this.quiescenceDepth > 0;
    if (short === this.shortEvaluation) return;
    this.shortEvaluation = short;
    this.ttFlag.fill(0);
    this.qFlag.fill(0);
    this.resetLocalEvaluation();
    const weights = short ? SHORT_WINDOW_EVALUATION : WINDOW_EVALUATION;
    this.windowEvaluation = 0;
    for (let window = 0; window < position.meta.windowCount; window += 1) {
      this.windowEvaluation += weights[this.windowCounts[window]];
    }
  }

  private updateLocalScore(position: GogoPosition, point: number): void {
    const cell = position.board[point];
    let score = 0;
    if (cell !== EMPTY) {
      const liberties = this.directLiberties[point];
      // Integer tenths retain the fractional center bias without accumulated
      // rounding error as moves and captures are repeatedly played and undone.
      const weights = this.shortEvaluation ? SHORT_LIBERTY_WEIGHTS : LOCAL_LIBERTY_WEIGHTS;
      score = position.meta.centerBias[point] * (this.shortEvaluation ? 2148 : 9) + weights[liberties] * 10;
      if (cell === WHITE) score = -score;
    } else if (this.forcingQuiescence) {
      score = this.captureGapScore(position, point, cell) * (this.shortEvaluation ? 305 / 48 : 10);
    }
    this.localEvaluation += score - this.localScores[point];
    this.localScores[point] = score;
  }

  /** Rebuild local scores after switching discovery's positional heuristics. */
  private resetLocalEvaluation(): void {
    this.evaluationPosition = null;
    this.evaluationBoard.fill(EMPTY);
    this.localScores.fill(0);
    this.localEvaluation = 0;
  }

  /** A supported gap makes a line block capturable; the edge supplies support too.
   * This is a positional hint, never a proof: captures and counterattacks matter.
   * Only orthogonal neighbors contribute, keeping make/undo updates local.
   */
  private captureGapScore(position: GogoPosition, point: number, cell = position.board[point]): number {
    const board = position.board;
    if (cell !== EMPTY) return 0;
    const neighbors = position.meta.neighbors4;
    const base = point * 4;
    // Off-board reads yield undefined; NaN from +1 becomes zero under shifts.
    const code = ((board[neighbors[base]] + 1) & 3)
      | ((board[neighbors[base + 1]] + 1) << 2)
      | ((board[neighbors[base + 2]] + 1) << 4)
      | ((board[neighbors[base + 3]] + 1) << 6);
    return CAPTURE_GAP_SCORES[code];
  }

  private generateNearbyMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateOrderedMoves(position, moves, scores, hintMove, false, ply);
  }

  /** Only the retained prefix needs ordering in capped discovery. */
  private generateBestNearbyMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateOrderedMoves(position, moves, scores, hintMove, false, ply, MAX_CANDIDATES);
  }

  private generateNearbyTacticalMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateOrderedMoves(position, moves, scores, hintMove, true, ply);
  }

  private generateOrderedMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Float64Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply = 0,
    sortLimit = position.area,
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

    const meta = position.meta;
    const near2Masks = meta.near2Masks;
    if (tacticalOnly) {
      return this.generateTacticalResponses(position, moves, scores, hintMove, ply);
    }
    this.beginPatternPass(position);
    this.candidateEpoch += 1;
    const seen = this.tacticalCandidates;
    const words = this.occupiedPoints.length;
    seen.set(this.occupiedPoints);
    if (position.koPoint !== -1) seen[position.koPoint >>> 5] |= 1 << (position.koPoint & 31);
    let count = 0;

    for (let word = 0; word < this.occupiedPoints.length; word += 1) {
      let bits = this.occupiedPoints[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const point = word * 32 + 31 - Math.clz32(bit);
        for (let nearbyWord = 0; nearbyWord < words; nearbyWord += 1) {
          let nearby = near2Masks[point * words + nearbyWord] & ~seen[nearbyWord];
          seen[nearbyWord] |= nearby;
          while (nearby !== 0) {
            const next = nearby & -nearby;
            nearby ^= next;
            const move = nearbyWord * 32 + 31 - Math.clz32(next);
            const score = this.scorePreparedMove(position, move, hintMove, ply);
            if (score === NO_SCORE) continue;
            moves[count] = move;
            scores[count] = score;
            count += 1;
          }
        }
      }
    }

    sortMovesDescending(moves, scores, count, sortLimit);
    return count;
  }

  private generateAttackingMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0, minimumStones = 3): number {
    return this.generateTacticalMoves(position, moves, scores, hintMove, ply, true, minimumStones);
  }

  private generateTacticalResponses(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply: number): number {
    return this.generateTacticalMoves(position, moves, scores, hintMove, ply, false);
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
    const mineCounts = player === BLACK ? WINDOW_BLACK_COUNTS : WINDOW_WHITE_COUNTS;
    const theirCounts = player === BLACK ? WINDOW_WHITE_COUNTS : WINDOW_BLACK_COUNTS;

    this.candidateEpoch += 1;
    this.tacticalCandidates.fill(0);

    for (let word = 0; word < this.activeWindows.length; word += 1) {
      let bits = this.activeWindows[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const windowIndex = word * 32 + 31 - Math.clz32(bit);
        const base = windowIndex * 5;
        const code = this.windowCounts[windowIndex];
        const mine = mineCounts[code];
        const theirs = theirCounts[code];
        // Active windows are already known to contain only one color.
        if (!(mine >= minimumStones || (!attackingOnly && theirs >= 3))) continue;
        // Every empty point of a qualifying window is a candidate. Mark it
        // directly; the epoch already deduplicates overlapping windows.
        for (let offset = 0; offset < 5; offset += 1) {
          const point = windows[base + offset];
          if (board[point] === EMPTY && point !== position.koPoint) {
            this.candidateMarks[point] = this.candidateEpoch;
            this.tacticalCandidates[point >>> 5] |= 1 << (point & 31);
          }
        }
      }
    }

    this.markGroupTacticalMoves(position, opponent);
    if (!attackingOnly) this.markGroupTacticalMoves(position, player);

    // Candidate marking establishes emptiness and ko legality. Share the
    // scoring and stable sorting path with full-board generation.
    return attackingOnly
      ? this.generateMarkedAttackMoves(position, moves, scores, hintMove, ply)
      : this.generateMarkedTacticalMoves(position, moves, scores, hintMove, ply);
  }

  /**
   * Discover liberties of tactical groups once per group. With responsePly < 0,
   * mark one- and two-liberty groups for later scoring. Otherwise append only
   * one-liberty captures to that ply's existing, priority-sorted response list.
   */
  private markGroupTacticalMoves(position: GogoPosition, groupColor: Player): number {
    return this.appendGroupTacticalMoves(position, groupColor, -1);
  }

  private appendGroupCaptureResponses(position: GogoPosition, groupColor: Player, ply: number, count: number): number {
    return this.appendGroupTacticalMoves(position, groupColor, ply, count);
  }

  private appendGroupTacticalMoves(
    position: GogoPosition,
    groupColor: Player,
    responsePly = -1,
    count = 0,
  ): number {
    this.beginWindowPass(position);
    const board = position.board;
    const neighbors = position.meta.neighbors4;
    const maximumLiberties = responsePly < 0 ? 2 : 1;

    if (this.scoredGroupHash !== position.hash) {
      this.scoredGroupPassEpoch += 1;
      this.scoredGroupHash = position.hash;
    }
    this.scorerGroupEpoch += 1;
    const groupEpoch = this.scorerGroupEpoch;
    for (let word = 0; word < this.occupiedPoints.length; word += 1) {
      let bits = this.occupiedPoints[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const point = word * 32 + 31 - Math.clz32(bit);
        if (board[point] !== groupColor || this.scorerGroupMarks[point] === groupEpoch) {
          continue;
        }
        if (this.hasExcessDirectLiberties(point, maximumLiberties)) continue;
        const liberties = position.scanGroup(point, groupColor);
        const size = position.scanGroupSize;
        const root = position.groupBuffer[0];
        // Scoring the candidates can reuse this traversal's exact group facts.
        for (let index = 0; index < size; index += 1) {
          const stone = position.groupBuffer[index];
          this.scorerGroupMarks[stone] = groupEpoch;
          this.scoredGroupEpoch[stone] = this.scoredGroupPassEpoch;
          this.scoredGroupLiberties[stone] = liberties;
          this.scoredGroupSizes[stone] = size;
          this.scoredGroupRoots[stone] = root;
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
              this.tacticalCandidates[neighbor >>> 5] |= 1 << (neighbor & 31);
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
    }
    return count;
  }

  /** Score and stably sort empty points, optionally scanning only tactical candidate bits. */
  private generateAllBoardMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply);
  }

  private generateBestAllBoardMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply, false, false, MAX_CANDIDATES);
  }

  private generateAllBoardTacticalMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateFullBoardMoves(position, moves, scores, hintMove, true, ply);
  }

  private generateMarkedMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply, true);
  }

  private generateMarkedAttackMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateFullBoardMoves(position, moves, scores, hintMove, false, ply, true, true);
  }

  private generateMarkedTacticalMoves(position: GogoPosition, moves: Int16Array, scores: Float64Array, hintMove: number, ply = 0): number {
    return this.generateFullBoardMoves(position, moves, scores, hintMove, true, ply, true);
  }

  private generateFullBoardMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Float64Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply = 0,
    markedOnly = false,
    directPatterns = false,
    sortLimit = position.area,
  ): number {
    if (directPatterns) this.beginWindowPass(position);
    else this.beginPatternPass(position);
    let count = 0;
    let word = 0;
    let bits = 0;
    for (let next = 0; next < position.area;) {
      let move: number;
      if (markedOnly) {
        while (bits === 0 && word < this.tacticalCandidates.length) {
          bits = this.tacticalCandidates[word++];
        }
        if (bits === 0) break;
        const bit = bits & -bits;
        bits ^= bit;
        move = (word - 1) * 32 + 31 - Math.clz32(bit);
      } else {
        move = next++;
        if (position.board[move] !== EMPTY || move === position.koPoint) continue;
      }
      const score = directPatterns
        ? this.scorePreparedAttackMove(position, move, hintMove, ply)
        : tacticalOnly
          ? this.scorePreparedTacticalMove(position, move, hintMove, ply)
          : this.scorePreparedMove(position, move, hintMove, ply);
      if (score === NO_SCORE) {
        continue;
      }
      moves[count] = move;
      scores[count] = score;
      count += 1;
    }
    sortMovesDescending(moves, scores, count, sortLimit);
    return count;
  }

  /** Callers prepare window state before using this lower bound on group liberties. */
  private hasExcessDirectLiberties(point: number, maximum: number): boolean {
    return this.directLiberties[point] > maximum;
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
    score += position.meta.centerBias[move] * (this.shortEvaluation && !this.proofOrdering ? 214.8 : CENTER_MULTIPLIER);
    score += this.history[(player - 1) * this.bufferArea + move];
    if (move === hintMove) {
      score += HINT_BONUS;
    }
    if (move === this.killerMoves[ply * 2] || move === this.killerMoves[ply * 2 + 1]) {
      score += KILLER_BONUS;
    }
    return score;
  }

  private scorePreparedMove(position: GogoPosition, move: number, hintMove: number, ply = 0): number {
    return this.scoreMove(position, move, hintMove, false, ply, true);
  }

  private scorePreparedAttackMove(position: GogoPosition, move: number, hintMove: number, ply = 0): number {
    return this.scoreMove(position, move, hintMove, false, ply, true, true);
  }

  private scorePreparedTacticalMove(position: GogoPosition, move: number, hintMove: number, ply = 0): number {
    return this.scoreMove(position, move, hintMove, true, ply, true);
  }

  private scoreUnpreparedMove(position: GogoPosition, move: number, hintMove: number, ply = 0): number {
    return this.scoreMove(position, move, hintMove, false, ply, false);
  }

  private scoreUnpreparedTacticalMove(position: GogoPosition, move: number, hintMove: number, ply = 0): number {
    return this.scoreMove(position, move, hintMove, true, ply, false);
  }

  private scoreMove(position: GogoPosition, move: number, hintMove: number, tacticalOnly: boolean, ply = 0, prepared = false, directPatterns = false): number {
    if (!prepared) this.beginPatternPass(position);
    const player = position.toMove;
    const opponent = otherPlayer(player);
    const meta = position.meta;
    const board = position.board;
    let pattern = 0;
    if (directPatterns) {
      const weights = this.shortEvaluation && !this.proofOrdering
        ? (player === BLACK ? SHORT_MOVE_BLACK : SHORT_MOVE_WHITE)
        : (player === BLACK ? WINDOW_PATTERN_BLACK : WINDOW_PATTERN_WHITE);
      for (let index = meta.windowsByPointOffsets[move]; index < meta.windowsByPointOffsets[move + 1]; index += 1) {
        const window = meta.windowsByPoint[index];
        pattern += weights[this.windowCounts[window]];
      }
    } else {
      pattern = player === BLACK ? this.pointPatternBlack[move] : this.pointPatternWhite[move];
    }

    let tacticalPattern = pattern;
    if (this.shortEvaluation && !this.proofOrdering && tacticalOnly) {
      tacticalPattern = 0;
      const weights = player === BLACK ? WINDOW_PATTERN_BLACK : WINDOW_PATTERN_WHITE;
      for (let index = meta.windowsByPointOffsets[move]; index < meta.windowsByPointOffsets[move + 1]; index += 1) {
        tacticalPattern += weights[this.windowCounts[meta.windowsByPoint[index]]];
      }
    }

    // A point belongs to at most 20 windows. Without a four-stone window,
    // their combined attack/defense weights stay below the tactical threshold.
    if (tacticalOnly && tacticalPattern >= TACTICAL_PATTERN_THRESHOLD) {
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
      if (this.hasExcessDirectLiberties(neighbor, 2)) continue;
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

  private checkTimeNow(): void {
    return this.checkTime(true);
  }

  private checkTimePeriodically(): void {
    return this.checkTime(false);
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
    // Reset history/killers, preserving only full-search proof facts inside a
    // candidate batch. Heuristic TT scores never serve as proofs.
    this.resetMoveOrdering();
    if (!this.reuseProofCache) this.clearProofTable();
  }

  private clearProofTable(): void {
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
    const previousOrdering = this.proofOrdering;
    this.proofOrdering = true;
    const deadline = this.deadline;
    try {
      // Forcing sequences are much cheaper to prove than quiet setups. Give
      // them a bounded first pass, reserving most of the budget for broader wins.
      // A shared batch stays in full mode so restricted failures cannot be
      // mixed with reusable full-search bounds.
      for (const forcingOnly of this.reuseProofCache ? [false] : [true, false]) {
        this.forcingProofMode = forcingOnly;
        this.deadline = forcingOnly ? deadline - Math.max(0, timeLimitMs) * 3 / 4 : deadline;
        // Both generators coincide at short horizons. A restricted failure
        // remains a valid bound there; longer quiet setups need a fresh search.
        if (!forcingOnly && !this.reuseProofCache) {
          for (let index = 0; index < this.proofTTDepth.length; index += 1) {
            this.proofTTDepth[index] = Math.min(this.proofTTDepth[index], SHARED_PROOF_HORIZON);
          }
        }
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
      this.proofOrdering = previousOrdering;
      this.forcingProofMode = false;
      this.deadline = deadline;
      position.undo();
    }
  }

  /**
   * Attacker (OR node): try to find at least one forcing move that wins.
   * Includes quiet setup moves when the horizon permits. If any wins, return true.
   */
  private proofAttack(position: GogoPosition, depthLeft: number, ply: number, hintMove = -1): boolean {
    this.checkTimePeriodically();

    // If there's a winner, it must be the opponent (the one who just played)
    // since we're the attacker looking to move. This means we lost.
    if (position.winner !== EMPTY) return false;
    if (depthLeft <= 0) return false;

    // Proof TT probe
    const hash = position.hash;
    const ttIdx = Number(BigInt.asUintN(TT_SIZE_BITS, hash));
    let ttBest = -1;
    if (this.proofTTHash[ttIdx] === hash) {
      // A proven win is an exact fact about this position. A failed proof
      // only rules out wins at the same or a smaller search depth.
      if (this.proofTTResult[ttIdx] === 1) return true;
      if (this.proofTTResult[ttIdx] === -1 && this.proofTTDepth[ttIdx] >= depthLeft) return false;
      ttBest = this.proofTTBestMove[ttIdx];
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

    if (hintMove !== -1 && hintMove !== ttBest && this.proveAttackMove(position, hintMove, depthLeft - 1, ply + 1)) {
      this.storeProofTT(ttIdx, hash, depthLeft, 1, hintMove);
      return true;
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    // An attacker facing an immediate counter-win must answer it too. Every
    // other move loses on the defender's next turn; captures and counter-wins
    // are included by the same complete response generator as defense nodes.
    const responses = this.findThreatResponses(position, ply);
    // Longer wins can need quiet setup moves before the forcing sequence.
    // Loss verification keeps a bounded forcing attack set and exhaustive defenses.
    // With at most two attacking turns, a four or tactical capture is needed.
    const rootLossReply = this.lossProofMode && ply === 1;
    const forcingOnly = depthLeft <= SHARED_PROOF_HORIZON || this.lossProofMode || this.forcingProofMode;
    const minimumStones = rootLossReply || !forcingOnly ? 2 : 3;
    let count = responses >= 0 ? responses
      : this.generateAttackingMoves(position, moves, scores, -1, ply, minimumStones);

    const markBase = ply * this.bufferArea;
    this.proofAttackMarks.fill(0, markBase, markBase + this.bufferArea);
    let usedQuiet = false;
    for (;;) {
      for (let i = 0; i < count; i += 1) {
        const m = moves[i];
        // already tried above
        if (m === ttBest || m === hintMove || this.proofAttackMarks[markBase + m] !== 0) continue;
        this.proofAttackMarks[markBase + m] = 1;
        if (this.proveAttackMove(position, m, depthLeft - 1, ply + 1)) {
          this.storeProofTT(ttIdx, hash, depthLeft, 1, m);
          return true;
        }
      }

      if (usedQuiet || responses >= 0 || forcingOnly) break;
      count = this.generateNearbyMoves(position, moves, scores, -1, ply);
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
    this.checkTimePeriodically();

    // Opponent (attacker) just made five - attacker wins
    if (position.winner !== EMPTY) return true;
    if (depthLeft <= 1) return false;

    // Proof TT probe
    const hash = position.hash;
    const ttIdx = Number(BigInt.asUintN(TT_SIZE_BITS, hash));
    let ttBest = -1;
    if (this.proofTTHash[ttIdx] === hash) {
      // A proven win is an exact fact about this position. A failed proof
      // only rules out wins at the same or a smaller search depth.
      if (this.proofTTResult[ttIdx] === 1) return true;
      if (this.proofTTResult[ttIdx] === -1 && this.proofTTDepth[ttIdx] >= depthLeft) return false;
      ttBest = this.proofTTBestMove[ttIdx];
    }

    // Shared batches can cache a short refutation without choosing a defense:
    // one attacking turn needs an existing four, since defenses only add
    // blockers or remove attacking stones. Preserve independent-proof ordering
    // and explicit hints; ko can clear a forbidden winning point.
    if (this.reuseProofCache && ttBest === -1 && depthLeft <= 3
      && position.koPoint === -1 && this.findThreatResponses(position, ply) < 0) {
      this.storeProofTT(ttIdx, hash, depthLeft, -1);
      return false;
    }

    if (ttBest === -1) ttBest = this.killerMoves[ply * 2];

    let anyLegalCount = 0;
    const triedEpoch = this.triedMoveEpoch++;
    const triedBase = ply * this.bufferArea;
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
          count = this.generateNearbyTacticalMoves(position, moves, scores, -1, ply);
          break;
        case NEARBY:
          count = this.generateNearbyMoves(position, moves, scores, -1, ply);
          break;
        default:
          count = this.generateAllBoardMoves(position, moves, scores, -1, ply);
      }

      let stageLegalCount = 0;
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (stage === HINTS && (move === -1 || position.board[move] !== EMPTY || move === position.koPoint)) continue;
        if (this.triedMoveMarks[triedBase + move] === triedEpoch) continue;
        this.triedMoveMarks[triedBase + move] = triedEpoch;
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
   * Response moves include:
   * 1. Blocking cells — empty cells in attacker's four-windows
   * 2. Capture cells — last-liberty cells of attacker groups
   * 3. Own-winning cells — empty cells in defender's four-windows
   *
   * This is sound because any other defender move allows the attacker to
   * complete the four on the next turn.
   */
  private findThreatResponses(position: GogoPosition, ply: number): number {
    const defender = position.toMove;
    const attacker = otherPlayer(defender);
    const meta = position.meta;
    const windows = meta.windows;
    const board = position.board;

    this.beginWindowPass(position);
    const attackingCode = attacker === BLACK ? 24 : 4;
    const defendingCode = defender === BLACK ? 24 : 4;

    this.candidateEpoch += 1;
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = 0;
    let hasThreat = false;

    // Scan all windows for attacker's open fours and defender's open fours
    for (let word = 0; word < this.winningWindows.length; word += 1) {
      let bits = this.winningWindows[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const wi = word * 32 + 31 - Math.clz32(bit);
        const base = wi * 5;
        const code = this.windowCounts[wi];
        const threat = code === attackingCode;
        const counterWin = code === defendingCode;

        // A qualifying five-cell window has exactly one empty point.
        let emptyCell = windows[base];
        for (let j = 0; j < 5; j += 1) {
          if (board[windows[base + j]] !== EMPTY) continue;
          emptyCell = windows[base + j];
          break;
        }
        if (emptyCell === position.koPoint) continue;
        if (threat) hasThreat = true;
        count = this.insertOrPromoteMove(moves, scores, count, emptyCell, counterWin ? 3_000_000 : 2_000_000);
      }
    }

    if (!hasThreat) return -1;

    // Capturing a one-liberty attacker group can break the four. Reuse the
    // tactical group traversal, retaining response priorities and stable ties.
    return this.appendGroupCaptureResponses(position, attacker, ply, count);
  }
}
