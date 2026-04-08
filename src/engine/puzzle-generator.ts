/**
 * Puzzle Generator Tool
 *
 * Generates and validates Gomoku puzzles.  A valid puzzle of difficulty (n, m)
 * satisfies five conditions – see {@link validatePuzzleCandidate} for details.
 *
 * 1. **ProofSearcher** – minimax with alpha-beta, *no heuristic evaluation* at
 *    leaf nodes (returns 0 = inconclusive).  Uses near-stones move generation
 *    (like GogoAI) for tractable branching.  Every positive score corresponds
 *    to an actual five-in-a-row terminal.
 *
 * 2. **validatePuzzleCandidate** – five checks in cost order.
 *
 * 3. **Candidate generation helpers** – AI-vs-AI games + screening.
 */

import {
  BLACK,
  EMPTY,
  WHITE,
  GogoPosition,
  encodeMove,
  type Player,
  type SupportedSize,
} from './gogomoku';
import { GogoAI, type GogoAIOptions } from './ai';

/* ================================================================ */
/* Constants                                                        */
/* ================================================================ */

/** Win sentinel: a win at depth d is encoded `PROOF_WIN - d`. */
export const PROOF_WIN = 100_000;

const ATTACK_WEIGHTS = [0, 12, 72, 540, 8_000, 500_000] as const;
const DEFENSE_WEIGHTS = [0, 16, 96, 720, 100_000, 500_000] as const;
const CENTER_MULTIPLIER = 3;
const AI_WIN_THRESHOLD = 900_000_000;

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

/* ================================================================ */
/* ProofSearcher                                                    */
/* ================================================================ */

export interface FirstMoveAnalysis {
  move: number;
  /** Plies from ply 0 to forced win, or -1. */
  winPly: number;
}

/**
 * Minimax proof-search engine with alpha-beta pruning.
 *
 * **No heuristic leaves** – leaf = 0 (inconclusive).  Guarantees every
 * positive score is an actual five-in-a-row terminal.
 *
 * **Near-stones move generation** – only cells within distance 2 of any
 * existing stone are considered (same as GogoAI).  This keeps branching
 * tractable (~20-30 moves vs ~60+ for full board).  Correctness: any
 * winning or blocking move must be adjacent to existing stones.
 * Fallback to full-board if no near moves (e.g. empty board).
 */
export class ProofSearcher {
  private readonly moveBuffers: Int16Array[];
  private readonly scoreBuffers: Int32Array[];
  private readonly candidateMarks: Uint32Array;
  private candidateEpoch: number;
  private readonly area: number;
  nodes = 0;

  constructor(area: number, maxPly: number) {
    this.area = area;
    this.moveBuffers = Array.from({ length: maxPly + 1 }, () => new Int16Array(area));
    this.scoreBuffers = Array.from({ length: maxPly + 1 }, () => new Int32Array(area));
    this.candidateMarks = new Uint32Array(area);
    this.candidateEpoch = 1;
    this.nodes = 0;
  }

  /** Proof search; score from current player's perspective. */
  search(position: GogoPosition, maxDepth: number): number {
    this.nodes = 0;
    return this.negamax(position, maxDepth, 0, -PROOF_WIN, PROOF_WIN) || 0;
  }

  /** Analyse every legal first move for forced-win depth. */
  analyzeFirstMoves(position: GogoPosition, maxDepth: number): FirstMoveAnalysis[] {
    const results: FirstMoveAnalysis[] = [];
    const rootMoves = new Int16Array(this.area);
    const count = position.generateAllLegalMoves(rootMoves);

    for (let i = 0; i < count; i += 1) {
      const move = rootMoves[i];
      if (!position.play(move)) {
        continue;
      }
      this.nodes = 0;
      const score = (-this.negamax(position, maxDepth, 1, -PROOF_WIN, PROOF_WIN)) || 0;
      position.undo();

      let winPly = -1;
      if (score > 0) {
        winPly = PROOF_WIN - score;
      }
      results.push({ move, winPly });
    }
    return results;
  }

  /* ---- Core negamax ---- */

  private negamax(
    position: GogoPosition,
    maxDepth: number,
    depth: number,
    alpha: number,
    beta: number,
  ): number {
    this.nodes += 1;

    if (position.winner !== EMPTY) {
      return -(PROOF_WIN - depth);
    }
    if (depth >= maxDepth) {
      return 0;
    }

    const moves = this.moveBuffers[depth];
    const scores = this.scoreBuffers[depth];
    const count = this.generateNearAndScore(position, moves, scores);

    if (count === 0) {
      return 0;
    }

    let bestScore = -(PROOF_WIN);
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      if (!position.play(move)) {
        continue; /* v8 ignore -- defensive guard */
      }
      const score = -this.negamax(position, maxDepth, depth + 1, -beta, -alpha);
      position.undo();

      if (score > bestScore) {
        bestScore = score;
      }
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          break;
        }
      }
    }
    return bestScore;
  }

  /* ---- Near-stones move generation & ordering ---- */

  /**
   * Generate moves within distance 2 of any stone, score, and sort.
   *
   * **Why near-stones only:**  Moves far from all stones cannot create or
   * block five-in-a-row.  Within the shallow depth of puzzle proofs, such
   * moves are always irrelevant.  This reduces branching from ~60 to ~20-30
   * on a 9×9 board, making depth-9 search tractable.
   *
   * Falls back to full-board if no near-stone moves exist (empty board).
   */
  private generateNearAndScore(
    position: GogoPosition,
    moves: Int16Array,
    scores: Int32Array,
  ): number {
    const meta = position.meta;
    const board = position.board;
    const near2 = meta.near2;
    const near2Offsets = meta.near2Offsets;
    this.candidateEpoch += 1;
    let count = 0;

    for (let point = 0; point < this.area; point += 1) {
      if (board[point] === EMPTY) {
        continue;
      }
      for (let cursor = near2Offsets[point]; cursor < near2Offsets[point + 1]; cursor += 1) {
        const move = near2[cursor];
        if (
          board[move] !== EMPTY ||
          move === position.koPoint ||
          this.candidateMarks[move] === this.candidateEpoch
        ) {
          continue;
        }
        if (!position.isLegal(move)) {
          this.candidateMarks[move] = this.candidateEpoch;
          continue;
        }
        this.candidateMarks[move] = this.candidateEpoch;
        scores[count] = this.scoreMoveForProof(position, move);
        moves[count] = move;
        count += 1;
      }
    }

    /* Fallback: empty board → centre move. */
    if (count === 0 && position.stoneCount === 0) {
      const center = ((position.size >> 1) * position.size) + (position.size >> 1);
      if (position.isLegal(center)) {
        moves[0] = center;
        scores[0] = 0;
        count = 1;
      }
    }

    /* Insertion sort descending by score. */
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
    return count;
  }

  private scoreMoveForProof(position: GogoPosition, move: number): number {
    const player = position.toMove;
    const opponent = otherPlayer(player);
    const meta = position.meta;
    const board = position.board;
    const windowsByPoint = meta.windowsByPoint;
    const windowOffsets = meta.windowsByPointOffsets;
    const windows = meta.windows;

    let score = 0;
    for (let cursor = windowOffsets[move]; cursor < windowOffsets[move + 1]; cursor += 1) {
      const windowIndex = windowsByPoint[cursor];
      const base = windowIndex * 5;
      let mine = 0;
      let theirs = 0;
      for (let step = 0; step < 5; step += 1) {
        const cell = board[windows[base + step]];
        mine += cell === player ? 1 : 0;
        theirs += cell === opponent ? 1 : 0;
      }
      if (theirs === 0) {
        score += ATTACK_WEIGHTS[Math.min(mine + 1, 5)];
      }
      if (mine === 0) {
        score += DEFENSE_WEIGHTS[Math.min(theirs + 1, 5)];
      }
    }
    score += meta.centerBias[move] * CENTER_MULTIPLIER;
    return score;
  }
}

/* ================================================================ */
/* Puzzle Validation                                                */
/* ================================================================ */

export interface PuzzleValidationResult {
  valid: boolean;
  reason: string;
  solution?: string;
  solutionMove?: number;
}

export interface ValidationOptions {
  strictFailureBonus?: number;
  /** @internal Skip the not-obvious check (for testing). */
  skipNotObvious?: boolean;
}

/**
 * Validate a position against all five puzzle conditions for difficulty (n, m).
 *
 * Check ordering (cheapest / most-selective first):
 * 1. Unique Solution at depth n  (defines the solution move)
 * 2. Not Obvious                 (needs solution from step 1)
 * 3. Threshold m                 (needs losing-move list from step 1)
 * 4. Strict Failure              (deeper search for alternative wins)
 * 5. Realistic                   (game-history scan)
 */
export function validatePuzzleCandidate(
  position: GogoPosition,
  n: number,
  m: number,
  options: ValidationOptions = {},
): PuzzleValidationResult {
  const strictFailureBonus = options.strictFailureBonus ?? 4;
  const skipNotObvious = options.skipNotObvious ?? false;
  const maxPly = n + strictFailureBonus + 2;
  const searcher = new ProofSearcher(position.area, maxPly);

  /* Step 1: Unique solution at exact depth n */
  const firstMoves = searcher.analyzeFirstMoves(position, n);
  const winners = firstMoves.filter((r) => r.winPly === n);
  const anyWinners = firstMoves.filter((r) => r.winPly !== -1);

  if (winners.length === 0) {
    return { valid: false, reason: `No move forces a win in exactly ${n} plies` };
  }
  if (anyWinners.length > 1) {
    return { valid: false, reason: `Multiple winning first moves at depth ${n}` };
  }
  if (winners.length !== 1) {
    return { valid: false, reason: 'Unique-winner invariant broken' };
  }

  const solutionMove = winners[0].move;
  const solution = encodeMove(solutionMove, position.meta);

  /* Step 2: Not Obvious */
  if (!skipNotObvious) {
    const shallowAI = new GogoAI({ maxDepth: 1, quiescenceDepth: 0 });
    const shallowResult = shallowAI.findBestMove(position, 10_000);
    if (shallowResult.move === solutionMove) {
      return { valid: false, reason: 'Not-obvious check failed: shallow AI finds the solution' };
    }
  }

  /* Step 3: Threshold m */
  const losingMoves = firstMoves.filter((r) => r.winPly === -1);
  const thresholdSearchDepth = m - 1;

  for (const { move } of losingMoves) {
    if (!position.play(move)) {
      continue;
    }
    const oppScore = searcher.search(position, thresholdSearchDepth);
    position.undo();

    if (oppScore > 0) {
      const totalPly = (PROOF_WIN - oppScore) + 1;
      if (totalPly < m) {
        const moveName = encodeMove(move, position.meta);
        return {
          valid: false,
          reason: `Threshold violated: after losing move ${moveName}, opponent wins in ${totalPly} plies (need >= ${m})`,
        };
      }
    }
  }

  /* Step 4: Strict Failure */
  const strictDepth = n + strictFailureBonus;
  for (const { move } of losingMoves) {
    if (!position.play(move)) {
      continue;
    }
    const score = -searcher.search(position, strictDepth);
    position.undo();

    if (score > 0) {
      const winPly = PROOF_WIN - score + 1;
      const moveName = encodeMove(move, position.meta);
      return {
        valid: false,
        reason: `Strict failure violated: move ${moveName} wins in ${winPly} plies from ply 0`,
      };
    }
  }

  /* Step 5: Realistic */
  const realisticResult = checkRealistic(position, searcher);
  if (!realisticResult.ok) {
    return { valid: false, reason: realisticResult.reason };
  }

  return { valid: true, reason: 'All checks passed', solution, solutionMove };
}

/** Replay game history and verify no forced win in ≤ 3 plies at any position. */
export function checkRealistic(
  position: GogoPosition,
  searcher: ProofSearcher,
): { ok: boolean; reason: string } {
  const replay = new GogoPosition(position.size);

  for (let i = 0; i < position.ply; i += 1) {
    const score = searcher.search(replay, 3);
    if (score > 0) {
      const winPly = PROOF_WIN - score;
      if (winPly <= 3) {
        return {
          ok: false,
          reason: `Realistic check failed at ply ${i}: moving player has forced win in ${winPly} plies`,
        };
      }
    }
    replay.play(position.getMoveAt(i));
  }

  return { ok: true, reason: '' };
}

/* ================================================================ */
/* Candidate Generation                                            */
/* ================================================================ */

export interface CandidateGeneratorConfig {
  boardSize?: SupportedSize;
  weakAI?: GogoAIOptions;
  strongAI?: GogoAIOptions;
  timeLimitMs?: number;
  maxGameMoves?: number;
}

export interface PuzzleCandidate {
  encoded: string;
  strongMove: number;
}

const DEFAULT_WEAK_AI: GogoAIOptions = { maxDepth: 2, quiescenceDepth: 2 };
const DEFAULT_STRONG_AI: GogoAIOptions = { maxDepth: 4, quiescenceDepth: 1 };

/** Play one AI-vs-AI game and return the resulting position. */
export function playAIGame(config: CandidateGeneratorConfig = {}): GogoPosition {
  const size = config.boardSize ?? 9;
  const aiOpts = config.weakAI ?? DEFAULT_WEAK_AI;
  const timeLimit = config.timeLimitMs ?? 500;
  const maxMoves = config.maxGameMoves ?? 60;

  const position = new GogoPosition(size);
  const ai = new GogoAI(aiOpts);

  while (position.winner === EMPTY && position.ply < maxMoves) {
    const result = ai.findBestMove(position, timeLimit);
    if (result.move === -1) {
      break;
    }
    position.play(result.move);
  }
  return position;
}

/** Screen a position: does the strong AI see a win the weak AI misses? */
export function screenPosition(
  position: GogoPosition,
  config: CandidateGeneratorConfig = {},
): PuzzleCandidate | null {
  if (position.winner !== EMPTY) {
    return null;
  }

  const weakOpts = config.weakAI ?? DEFAULT_WEAK_AI;
  const strongOpts = config.strongAI ?? DEFAULT_STRONG_AI;
  const timeLimit = config.timeLimitMs ?? 500;

  const weakAI = new GogoAI(weakOpts);
  const strongAI = new GogoAI(strongOpts);

  const strongResult = strongAI.findBestMove(position, timeLimit * 4);
  if (strongResult.score < AI_WIN_THRESHOLD) {
    return null;
  }

  const weakResult = weakAI.findBestMove(position, timeLimit);
  if (weakResult.score >= AI_WIN_THRESHOLD) {
    return null;
  }

  return { encoded: position.encodeGame(), strongMove: strongResult.move };
}

/** Replay a completed game and collect all candidate positions. */
export function findCandidatesInGame(
  game: GogoPosition,
  config: CandidateGeneratorConfig = {},
): PuzzleCandidate[] {
  const candidates: PuzzleCandidate[] = [];
  const replay = new GogoPosition(game.size);

  for (let i = 0; i < game.ply; i += 1) {
    const candidate = screenPosition(replay, config);
    if (candidate !== null) {
      candidates.push(candidate);
    }
    replay.play(game.getMoveAt(i));
  }
  return candidates;
}
