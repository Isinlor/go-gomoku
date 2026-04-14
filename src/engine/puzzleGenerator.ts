import {
  BLACK,
  EMPTY,
  WHITE,
  GogoPosition,
  encodeMove,
  type Player,
  type SupportedSize,
} from './gogomoku';
import { GogoAI } from './ai';

/**
 * Validation criteria for a puzzle position at a given difficulty level:
 * 1. unique correct answer: a unique move that has a shortest forced winning sequence in exactly n plies, there maybe other winning moves but the alternative forcing sequence must be strictly longer than n+3 plies
 * 2. no immediate threats: there is no forced loosing sequence for the moving player in m plies
 * 3. not obvious: a basic heuristic search with ply k must not select the unique correct answer
 * 4. realistic: there must be no obvious blunders in game history; no missed forced win sequences in ply 3
 */

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

const ATTACK_WEIGHTS = [0, 12, 72, 540, 8_000, 500_000] as const;
const DEFENSE_WEIGHTS = [0, 16, 96, 720, 100_000, 500_000] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PuzzleDifficulty {
  readonly n: number; // forced win plies
  readonly m: number; // no forced loss plies
  readonly k: number; // heuristic depth that must NOT find the answer
}

export const BEGINNER: PuzzleDifficulty = { n: 3, m: 2, k: 0 };
export const INTERMEDIATE: PuzzleDifficulty = { n: 5, m: 4, k: 2 };
export const ADVANCED: PuzzleDifficulty = { n: 7, m: 4, k: 2 };
export const EXPERT: PuzzleDifficulty = { n: 9, m: 4, k: 4 };

export interface PuzzleCandidate {
  readonly encoded: string;
  readonly toMove: Player;
  readonly solution: string;
  readonly solutionIndex: number;
  readonly depth: number;
  readonly threshold: number;
  /** Encoded board state after the complete winning sequence is played out. */
  readonly wonEncoded: string;
  /** The full winning sequence as move strings (solution + responses). */
  readonly winningMoves: readonly string[];
}

export interface GeneratorStats {
  gamesPlayed: number;
  positionsChecked: number;
  puzzlesFound: number;
  totalTimeMs: number;
  totalNodes: number;
}

// ---------------------------------------------------------------------------
// ForcedWinSearcher – fast proof-tree search for forced wins
// ---------------------------------------------------------------------------

export class ForcedWinSearcher {
  private readonly moveBuffers: Int16Array[];
  private readonly scoreBuffers: Int32Array[];
  private readonly candidateMarks: Uint32Array;
  private readonly threatBuffer: Int16Array;
  private candidateEpoch = 0;
  private readonly area: number;
  nodesSearched = 0;

  constructor(area: number, maxDepth: number) {
    this.area = area;
    this.moveBuffers = [];
    this.scoreBuffers = [];
    for (let i = 0; i <= maxDepth; i += 1) {
      this.moveBuffers.push(new Int16Array(area));
      this.scoreBuffers.push(new Int32Array(area));
    }
    this.candidateMarks = new Uint32Array(area);
    this.threatBuffer = new Int16Array(area);
  }

  /**
   * Can `attacker` force a win within `maxPly` half-moves from this position?
   */
  hasForcedWin(pos: GogoPosition, attacker: Player, maxPly: number): boolean {
    this.nodesSearched = 0;
    return this.search(pos, attacker, maxPly, 0);
  }

  /**
   * For a given move by the current player, what is the shortest forced-win
   * ply count?  Returns -1 when no forced win exists within `maxPly`.
   * Forced wins only happen at odd plies (1, 3, 5, …).
   */
  forcedWinDepthForMove(pos: GogoPosition, move: number, maxPly: number): number {
    const attacker = pos.toMove;
    if (!pos.play(move)) {
      return -1;
    }

    // Ply 1: immediate win
    if (pos.winner === attacker) {
      pos.undo();
      return 1;
    }

    // Ply 3, 5, 7, … (remaining = 2, 4, 6, …)
    for (let remaining = 2; remaining <= maxPly - 1; remaining += 2) {
      this.nodesSearched = 0;
      if (this.search(pos, attacker, remaining, 0)) {
        pos.undo();
        return remaining + 1;
      }
    }

    pos.undo();
    return -1;
  }

  /**
   * Check if a specific move by the current player leads to a forced win
   * in *exactly* `targetRemaining` additional plies (so total = targetRemaining + 1).
   * Does NOT iterate; just tests one specific depth.
   */
  hasForcedWinAfterMove(pos: GogoPosition, move: number, targetRemaining: number): boolean {
    const attacker = pos.toMove;
    if (!pos.play(move)) {
      return false;
    }
    if (pos.winner === attacker) {
      pos.undo();
      return targetRemaining >= 0;
    }
    if (targetRemaining <= 0) {
      pos.undo();
      return false;
    }
    this.nodesSearched = 0;
    const result = this.search(pos, attacker, targetRemaining, 0);
    pos.undo();
    return result;
  }

  /**
   * Find all root moves that have a forced win within `maxPly`.
   * Returns -1 if no winning move, the single move index if exactly one,
   * or -2 if multiple moves win.
   * Only considers moves from the provided sorted buffer.
   * Much faster than calling forcedWinDepthForMove per move because we
   * skip the iterative deepening overhead and share search state.
   */
  findUniqueWinningMove(
    pos: GogoPosition,
    moves: Int16Array,
    moveCount: number,
    maxPly: number,
  ): number {
    const attacker = pos.toMove;
    const targetRemaining = maxPly - 1;
    let solutionMove = -1;

    for (let i = 0; i < moveCount; i += 1) {
      const move = moves[i];
      if (!pos.play(move)) {
        continue;
      }
      if (pos.winner === attacker) {
        pos.undo();
        return -2; // immediate win → shorter than target depth
      }
      this.nodesSearched = 0;
      const wins = this.search(pos, attacker, targetRemaining, 0);
      pos.undo();
      if (wins) {
        if (solutionMove !== -1) {
          return -2; // multiple winning moves
        }
        solutionMove = move;
      }
    }
    return solutionMove;
  }

  /**
   * Find the winning line (principal variation) from a position where a forced
   * win is known to exist. Returns an array of moves from the position to the
   * winning state. The first move is the attacker's solution move.
   */
  findWinningLine(pos: GogoPosition, maxPly: number): number[] {
    const attacker = pos.toMove;
    const line: number[] = [];

    for (let ply = 0; ply < maxPly; ply += 1) {
      if (pos.winner !== EMPTY) {
        break;
      }
      const isAtk = pos.toMove === attacker;
      const moveBuffer = new Int16Array(pos.area);
      const moveCount = pos.generateAllLegalMoves(moveBuffer);
      let bestMove = -1;

      if (isAtk) {
        // Attacker: find the move that leads to forced win
        for (let i = 0; i < moveCount; i += 1) {
          if (!pos.play(moveBuffer[i])) {
            continue;
          }
          if (pos.winner !== EMPTY) {
            bestMove = moveBuffer[i];
            pos.undo();
            break;
          }
          const remaining = maxPly - ply - 1;
          this.nodesSearched = 0;
          if (remaining > 0 && this.search(pos, attacker, remaining, 0)) {
            bestMove = moveBuffer[i];
            pos.undo();
            break;
          }
          pos.undo();
        }
      } else {
        // Defender: pick the first legal move (any move, attacker wins regardless)
        // Prefer the move that maximizes remaining plies (most resistant defense)
        for (let i = 0; i < moveCount; i += 1) {
          if (pos.play(moveBuffer[i])) {
            bestMove = moveBuffer[i];
            pos.undo();
            break;
          }
        }
      }

      if (bestMove === -1) {
        break;
      }
      line.push(bestMove);
      pos.play(bestMove);
    }

    // Undo all played moves to restore original position
    for (let i = line.length - 1; i >= 0; i -= 1) {
      pos.undo();
    }
    return line;
  }

  // ---- core search ----------------------------------------------------

  private search(
    pos: GogoPosition,
    attacker: Player,
    remaining: number,
    depth: number,
  ): boolean {
    this.nodesSearched += 1;

    if (pos.winner === attacker) {
      return true;
    }
    if (pos.winner !== EMPTY) {
      return false;
    }
    if (remaining <= 0) {
      return false;
    }

    const isAttacker = pos.toMove === attacker;
    const defender = otherPlayer(attacker);

    // Threat-based pruning — single pass over all windows
    const [attackerThreats, defenderThreats] = this.countBothThreats(pos, attacker, defender);

    if (isAttacker) {
      return this.searchAttacker(
        pos,
        attacker,
        remaining,
        depth,
        attackerThreats,
        defenderThreats,
      );
    }
    return this.searchDefender(
      pos,
      attacker,
      remaining,
      depth,
      attackerThreats,
      defenderThreats,
    );
  }

  private searchAttacker(
    pos: GogoPosition,
    attacker: Player,
    remaining: number,
    depth: number,
    attackerThreats: number,
    defenderThreats: number,
  ): boolean {
    // If attacker has a win-threat, try it first (completes 5-in-a-row)
    if (attackerThreats > 0) {
      const { moves: tMoves, count: tCount } = this.getWinThreatMoves(pos, attacker);
      for (let i = 0; i < tCount; i += 1) {
        if (!pos.play(tMoves[i])) {
          continue;
        }
        if (pos.winner === attacker) {
          pos.undo();
          return true;
        }
        // Even if it didn't win (captures changed things), try continuing
        const result = this.search(pos, attacker, remaining - 1, depth + 1);
        pos.undo();
        if (result) {
          return true;
        }
      }
    }

    // If defender has ≥2 threats and attacker has no immediate win, unlikely
    // to force a win (would need to win immediately or make captures).
    // Still search but with a reduced move set when remaining is small.
    if (defenderThreats >= 2 && remaining <= 2) {
      return false;
    }

    // If defender has exactly 1 threat, attacker MUST block it (or win first)
    if (defenderThreats === 1 && attackerThreats === 0) {
      const { moves: dMoves } = this.getWinThreatMoves(pos, otherPlayer(attacker));
      const block = dMoves[0];
      if (!pos.play(block)) {
        return false;
      }
      const result = this.search(pos, attacker, remaining - 1, depth + 1);
      pos.undo();
      return result;
    }

    // General case: try all ordered moves
    const count = this.generateMoves(pos, depth);
    const moves = this.moveBuffers[depth];

    // When remaining plies are low, limit the number of moves tried.
    // Attacker needs to create threats; only high-scoring moves can do that.
    const maxMoves = remaining <= 2 ? Math.min(count, 10) : count;

    for (let i = 0; i < maxMoves; i += 1) {
      if (!pos.play(moves[i])) {
        continue;
      }
      const result = this.search(pos, attacker, remaining - 1, depth + 1);
      pos.undo();
      if (result) {
        return true;
      }
    }
    return false;
  }

  private searchDefender(
    pos: GogoPosition,
    attacker: Player,
    remaining: number,
    depth: number,
    attackerThreats: number,
    defenderThreats: number,
  ): boolean {
    const defender = otherPlayer(attacker);

    // When the defender can capture attacker stones, threat-based shortcuts
    // are unsafe: a single capture can remove a stone that participates in
    // multiple threat windows, neutralizing what looks like a double threat.
    // In that case we fall through directly to the general case.
    const capturesSafe = attackerThreats === 0 || !this.canCaptureOpponent(pos, attacker);

    // If attacker has ≥2 win threats and defender has 0, attacker wins
    if (capturesSafe && attackerThreats >= 2 && defenderThreats === 0) {
      return true;
    }

    // If attacker has exactly 1 threat, defender must block it
    if (capturesSafe && attackerThreats === 1 && defenderThreats === 0) {
      const { moves: tMoves } = this.getWinThreatMoves(pos, attacker);
      const block = tMoves[0];
      if (!pos.play(block)) {
        // Can't block → attacker wins next move
        return true;
      }
      const result = this.search(pos, attacker, remaining - 1, depth + 1);
      pos.undo();
      return result;
    }

    // If defender has a win-threat, try it (escape by winning)
    if (defenderThreats > 0) {
      const { moves: dMoves, count: dCount } = this.getWinThreatMoves(pos, defender);
      for (let i = 0; i < dCount; i += 1) {
        if (!pos.play(dMoves[i])) {
          continue;
        }
        if (pos.winner === defender) {
          pos.undo();
          return false; // Defender won → attacker's forced win fails
        }
        const result = this.search(pos, attacker, remaining - 1, depth + 1);
        pos.undo();
        if (!result) {
          return false;
        }
      }
      // If attacker also has threats, defender might need to block those too
      if (capturesSafe && attackerThreats >= 2) {
        return true; // Double threat, defender already tried escaping
      }
      if (capturesSafe && attackerThreats === 1) {
        const { moves: aMoves } = this.getWinThreatMoves(pos, attacker);
        const block = aMoves[0];
        if (!pos.play(block)) {
          return true;
        }
        const result = this.search(pos, attacker, remaining - 1, depth + 1);
        pos.undo();
        return result;
      }
    }

    // General case: all defender moves must lead to attacker win
    const count = this.generateMoves(pos, depth);
    const moves = this.moveBuffers[depth];
    let anyLegal = false;

    for (let i = 0; i < count; i += 1) {
      if (!pos.play(moves[i])) {
        continue;
      }
      anyLegal = true;
      const result = this.search(pos, attacker, remaining - 1, depth + 1);
      pos.undo();
      if (!result) {
        return false;
      }
    }
    return anyLegal;
  }

  // ---- capture detection ------------------------------------------------

  /**
   * Check whether the current side to move can capture any group of the
   * given `target` colour (i.e. some target group has exactly 1 liberty).
   * Used to disable threat-based shortcuts that assume threats can only be
   * resolved by blocking, not by capturing the threatening stones.
   */
  private canCaptureOpponent(pos: GogoPosition, target: Player): boolean {
    const board = pos.board;
    const epoch = ++this.candidateEpoch;
    for (let i = 0; i < this.area; i += 1) {
      if (board[i] !== target || this.candidateMarks[i] === epoch) {
        continue;
      }
      const liberties = pos.scanGroup(i, target);
      for (let j = 0; j < pos.scanGroupSize; j += 1) {
        this.candidateMarks[pos.groupBuffer[j]] = epoch;
      }
      if (liberties === 1) {
        return true;
      }
    }
    return false;
  }

  // ---- threat detection -----------------------------------------------

  /** Count threats for both attacker and defender in a single window scan. */
  private countBothThreats(
    pos: GogoPosition,
    attacker: Player,
    defender: Player,
  ): [number, number] {
    const meta = pos.meta;
    const board = pos.board;
    const windows = meta.windows;
    let atkThreats = 0;
    let defThreats = 0;

    for (let wi = 0; wi < meta.windowCount; wi += 1) {
      const base = wi * 5;
      let atk = 0;
      let def = 0;
      let empties = 0;
      for (let step = 0; step < 5; step += 1) {
        const cell = board[windows[base + step]];
        if (cell === attacker) {
          atk += 1;
        } else if (cell === defender) {
          def += 1;
        } else {
          empties += 1;
        }
      }
      if (empties === 1) {
        if (atk === 4) {
          atkThreats += 1;
        }
        if (def === 4) {
          defThreats += 1;
        }
      }
    }
    return [atkThreats, defThreats];
  }

  private getWinThreatMoves(pos: GogoPosition, player: Player): { moves: Int16Array; count: number } {
    const meta = pos.meta;
    const board = pos.board;
    const windows = meta.windows;
    const buf = this.threatBuffer;
    let count = 0;
    // Use high bits of candidateMarks with a separate epoch to avoid seen-set allocation
    const epoch = ++this.candidateEpoch;

    for (let wi = 0; wi < meta.windowCount; wi += 1) {
      const base = wi * 5;
      let ours = 0;
      let empties = 0;
      let emptyPos = -1;
      for (let step = 0; step < 5; step += 1) {
        const cell = board[windows[base + step]];
        if (cell === player) {
          ours += 1;
        } else if (cell === EMPTY) {
          empties += 1;
          emptyPos = windows[base + step];
        }
      }
      if (ours === 4 && empties === 1 && this.candidateMarks[emptyPos] !== epoch) {
        this.candidateMarks[emptyPos] = epoch;
        buf[count] = emptyPos;
        count += 1;
      }
    }
    return { moves: buf, count };
  }

  // ---- move generation ------------------------------------------------

  private generateMoves(pos: GogoPosition, depth: number): number {
    const board = pos.board;
    const meta = pos.meta;
    const player = pos.toMove;
    const opponent = otherPlayer(player);
    const moves = this.moveBuffers[depth];
    const scores = this.scoreBuffers[depth];
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
          move === pos.koPoint ||
          this.candidateMarks[move] === this.candidateEpoch
        ) {
          continue;
        }
        this.candidateMarks[move] = this.candidateEpoch;

        const score = this.scoreMove(pos, move, player, opponent);

        // Insertion sort descending
        let idx = count;
        while (idx > 0 && score > scores[idx - 1]) {
          moves[idx] = moves[idx - 1];
          scores[idx] = scores[idx - 1];
          idx -= 1;
        }
        moves[idx] = move;
        scores[idx] = score;
        count += 1;
      }
    }

    // Fallback: all empty squares
    if (count === 0) {
      for (let move = 0; move < this.area; move += 1) {
        if (board[move] !== EMPTY || move === pos.koPoint) {
          continue;
        }
        moves[count] = move;
        scores[count] = 0;
        count += 1;
      }
    }

    return count;
  }

  private scoreMove(
    pos: GogoPosition,
    move: number,
    player: Player,
    opponent: Player,
  ): number {
    const meta = pos.meta;
    const board = pos.board;
    let attack = 0;
    let defense = 0;

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
        attack += ATTACK_WEIGHTS[Math.min(mine + 1, 5)];
      }
      if (mine === 0) {
        defense += DEFENSE_WEIGHTS[Math.min(theirs + 1, 5)];
      }
    }

    return attack + defense + meta.centerBias[move] * 3;
  }
}

// ---------------------------------------------------------------------------
// Puzzle validation helpers
// ---------------------------------------------------------------------------

/**
 * Compute a static heuristic score for a move (attack + defense + center).
 */
export function heuristicMoveScore(pos: GogoPosition, move: number): number {
  const player = pos.toMove;
  const opponent = otherPlayer(player);
  const meta = pos.meta;
  const board = pos.board;
  let attack = 0;
  let defense = 0;

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
      attack += ATTACK_WEIGHTS[Math.min(mine + 1, 5)];
    }
    if (mine === 0) {
      defense += DEFENSE_WEIGHTS[Math.min(theirs + 1, 5)];
    }
  }

  return attack + defense + meta.centerBias[move] * 3;
}

/**
 * Return the best move according to pure static heuristic (no tree search).
 */
export function heuristicBestMove(pos: GogoPosition): number {
  let bestMove = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let move = 0; move < pos.area; move += 1) {
    if (pos.board[move] !== EMPTY || move === pos.koPoint) {
      continue;
    }
    if (!pos.isLegal(move)) {
      continue;
    }
    const score = heuristicMoveScore(pos, move);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

/**
 * Verify the game history has no blunders (missed forced wins in ≤ 3 plies).
 * Skips early plies where there aren't enough stones for a forced win.
 */
export function isGameHistoryClean(
  pos: GogoPosition,
  searcher: ForcedWinSearcher,
): boolean {
  const temp = new GogoPosition(pos.size);
  // A forced win in 3 plies requires an open-three (3 stones + 2 empty in a window).
  // Black needs ≥3 stones → ply ≥5. White needs ≥3 stones → ply ≥6.
  // Use ply 6 as a safe lower bound for checking.
  const minPlyForThreat = 6; // skip early plies where forced wins are impossible

  for (let i = 0; i < pos.ply; i += 1) {
    const attacker = temp.toMove;
    const move = pos.getMoveAt(i);

    // Only check for forced wins when there are enough stones
    if (i >= minPlyForThreat) {
      // Quick pre-check: does the attacker have any open-three?
      if (hasOpenThree(temp, attacker)) {
        const hadForcedWin = searcher.hasForcedWin(temp, attacker, 3);
        if (hadForcedWin) {
          if (!temp.play(move)) {
            return false;
          }
          // Won immediately → fine
          if (temp.winner === attacker) {
            continue;
          }
          // Must still have forced win in 2 remaining plies
          if (!searcher.hasForcedWin(temp, attacker, 2)) {
            return false;
          }
          continue;
        }
      }
    }

    if (!temp.play(move)) {
      return false;
    }
  }
  return true;
}

/**
 * Full puzzle validation against a difficulty specification.
 *
 * Returns a `PuzzleCandidate` if the position qualifies, otherwise `null`.
 *
 * Checks are ordered from cheapest to most expensive for early rejection.
 */
/** Reusable buffers for validatePuzzlePosition to avoid per-call allocation. */
export interface ValidationBuffers {
  moveBuffer: Int16Array;
  hScores: Int32Array;
}

/** Create validation buffers for the given board area. */
export function createValidationBuffers(area: number): ValidationBuffers {
  return {
    moveBuffer: new Int16Array(area),
    hScores: new Int32Array(area),
  };
}

export function validatePuzzlePosition(
  pos: GogoPosition,
  difficulty: PuzzleDifficulty,
  searcher: ForcedWinSearcher,
  buffers?: ValidationBuffers,
): PuzzleCandidate | null {
  const { n, m, k } = difficulty;
  const attacker = pos.toMove;
  const defender = otherPlayer(attacker);

  // Must not already be over
  if (pos.winner !== EMPTY) {
    return null;
  }

  // Quick pre-filter: attacker must have at least one open-three (3 in a
  // window with 2 empty) to have any hope of a forced win.
  if (!hasOpenThree(pos, attacker)) {
    return null;
  }

  // 1. No immediate threat: opponent cannot force a win in m plies
  if (searcher.hasForcedWin(pos, defender, m)) {
    return null;
  }

  // 2. Check no immediate win (depth < n) first — very cheap
  //    Then check if attacker has a forced win at depth n.
  //    We use hasForcedWin at the full position level first as a fast gate.
  if (searcher.hasForcedWin(pos, attacker, Math.max(n - 2, 1))) {
    return null; // shorter win exists
  }
  if (!searcher.hasForcedWin(pos, attacker, n)) {
    return null; // no win at depth n either
  }

  // 3. Find the unique move with forced win in exactly n plies
  const moveBuffer = buffers?.moveBuffer ?? new Int16Array(pos.area);
  const moveCount = pos.generateAllLegalMoves(moveBuffer);

  // Sort moves by heuristic score descending — high-threat moves first
  const hScores = buffers?.hScores ?? new Int32Array(pos.area);
  for (let i = 0; i < moveCount; i += 1) {
    hScores[i] = heuristicMoveScore(pos, moveBuffer[i]);
  }
  sortMovesDescending(moveBuffer, hScores, moveCount);

  let solutionMove = -1;
  let solutionCount = 0;

  for (let i = 0; i < moveCount; i += 1) {
    const depth = searcher.forcedWinDepthForMove(pos, moveBuffer[i], n);
    if (depth === n) {
      solutionMove = moveBuffer[i];
      solutionCount += 1;
      if (solutionCount > 1) {
        return null;
      }
    } else if (depth > 0 && depth < n) {
      return null;
    }
  }

  if (solutionCount !== 1) {
    return null;
  }

  // 4. Not obvious: heuristic/AI at depth k must not select the solution
  //    (cheaper than uniqueness check, do it before)
  if (k === 0) {
    // The hScores are already computed — the first move (index 0) is best
    if (moveBuffer[0] === solutionMove) {
      return null;
    }
  } else {
    const ai = new GogoAI({ maxDepth: k, quiescenceDepth: 0, maxPly: k + 2 });
    const result = ai.findBestMove(pos, 5_000);
    if (result.move === solutionMove) {
      return null;
    }
  }

  // 5. Uniqueness: alternatives must not have forced win within n+3 plies.
  //    Check highest-threat alternatives first for fast rejection.
  const altMaxPly = n + 3;
  for (let i = 0; i < moveCount; i += 1) {
    if (moveBuffer[i] === solutionMove) {
      continue;
    }
    const altDepth = searcher.forcedWinDepthForMove(pos, moveBuffer[i], altMaxPly);
    if (altDepth !== -1) {
      return null;
    }
  }

  // 6. Realistic: game history has no missed forced-win-in-3
  if (!isGameHistoryClean(pos, searcher)) {
    return null;
  }

  // 7. Find the winning line and compute the won state
  const winLine = searcher.findWinningLine(pos, n + 2);
  const winningMoves = winLine.map((mv) => encodeMove(mv, pos.meta));

  // Play out the winning line to get the won board state
  for (const mv of winLine) {
    pos.play(mv);
  }
  const wonEncoded = pos.encodeGame();
  // Undo all winning line moves to restore original position
  for (let i = winLine.length - 1; i >= 0; i -= 1) {
    pos.undo();
  }

  return {
    encoded: pos.encodeGame(),
    toMove: attacker,
    solution: encodeMove(solutionMove, pos.meta),
    solutionIndex: solutionMove,
    depth: n,
    threshold: m,
    wonEncoded,
    winningMoves,
  };
}

/** Quick check: does the player have at least one open-three pattern? */
function hasOpenThree(pos: GogoPosition, player: Player): boolean {
  const meta = pos.meta;
  const board = pos.board;
  const windows = meta.windows;

  for (let wi = 0; wi < meta.windowCount; wi += 1) {
    const base = wi * 5;
    let ours = 0;
    let empties = 0;
    for (let step = 0; step < 5; step += 1) {
      const cell = board[windows[base + step]];
      ours += cell === player ? 1 : 0;
      empties += cell === EMPTY ? 1 : 0;
    }
    if (ours >= 3 && empties >= 2) {
      return true;
    }
  }
  return false;
}

/** In-place insertion sort for move/score arrays (descending by score). */
function sortMovesDescending(
  moves: Int16Array,
  scores: Int32Array,
  count: number,
): void {
  for (let i = 1; i < count; i += 1) {
    const move = moves[i];
    const score = scores[i];
    let j = i;
    while (j > 0 && scores[j - 1] < score) {
      moves[j] = moves[j - 1];
      scores[j] = scores[j - 1];
      j -= 1;
    }
    moves[j] = move;
    scores[j] = score;
  }
}

// ---------------------------------------------------------------------------
// Game generation (semi-random play for realistic positions)
// ---------------------------------------------------------------------------

export class LCG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/**
 * Play a semi-random game that avoids obvious blunders.
 *
 * Strategy:
 *  - Always play an immediate win (5-in-a-row).
 *  - Always block the opponent's immediate win.
 *  - Otherwise, pick a move weighted by heuristic score.
 */
export function playRandomGame(
  size: SupportedSize,
  rng: LCG,
  maxMoves: number,
): GogoPosition {
  const pos = new GogoPosition(size);
  const moveBuffer = new Int16Array(pos.area);
  const scoreBuffer = new Int32Array(pos.area);

  // First move: center
  pos.play(pos.index(size >> 1, size >> 1));

  while (pos.winner === EMPTY && pos.ply < maxMoves) {
    const count = pos.generateAllLegalMoves(moveBuffer);
    if (count === 0) {
      break;
    }

    // Check for immediate wins or blocks
    const player = pos.toMove;
    const opponent = otherPlayer(player);
    let forced = -1;

    for (let i = 0; i < count; i += 1) {
      const move = moveBuffer[i];
      if (!pos.play(move)) {
        continue;
      }
      if ((pos.winner as number) === player) {
        pos.undo();
        forced = move;
        break;
      }
      pos.undo();
    }

    if (forced === -1) {
      // Check opponent threats
      for (let i = 0; i < count; i += 1) {
        const move = moveBuffer[i];
        // Temporarily play as opponent to check if this point wins for them
        const saved = pos.toMove;
        pos.toMove = opponent;
        if (pos.play(move)) {
          const wins = (pos.winner as number) === opponent;
          pos.undo();
          pos.toMove = saved;
          if (wins) {
            forced = move;
            break;
          }
        } else {
          pos.toMove = saved;
        }
      }
    }

    if (forced !== -1) {
      pos.play(forced);
      continue;
    }

    // Weighted random selection by heuristic score
    let totalWeight = 0;
    for (let i = 0; i < count; i += 1) {
      const score = Math.max(1, heuristicMoveScore(pos, moveBuffer[i]));
      scoreBuffer[i] = score;
      totalWeight += score;
    }

    let threshold = rng.next() * totalWeight;
    let chosen = moveBuffer[count - 1];
    for (let i = 0; i < count; i += 1) {
      threshold -= scoreBuffer[i];
      if (threshold <= 0) {
        chosen = moveBuffer[i];
        break;
      }
    }
    pos.play(chosen);
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export interface GeneratorOptions {
  readonly size?: SupportedSize;
  readonly seed?: number;
  readonly maxMovesPerGame?: number;
  readonly minStones?: number;
  readonly maxGames?: number;
  readonly onProgress?: (stats: GeneratorStats) => void;
}

export function generatePuzzles(
  difficulty: PuzzleDifficulty,
  count: number,
  options: GeneratorOptions = {},
): { puzzles: PuzzleCandidate[]; stats: GeneratorStats } {
  const size: SupportedSize = options.size ?? 9;
  const maxMovesPerGame = options.maxMovesPerGame ?? 40;
  const minStones = options.minStones ?? Math.max(6, difficulty.n + 3);
  const maxGames = options.maxGames ?? 100_000;
  const maxSearchDepth = difficulty.n + 6;

  const rng = new LCG(options.seed ?? 42);
  const searcher = new ForcedWinSearcher(size * size, maxSearchDepth);
  const validationBuffers = createValidationBuffers(size * size);
  const puzzles: PuzzleCandidate[] = [];
  const seenEncodings = new Set<string>();
  const startTime = performance.now();

  const stats: GeneratorStats = {
    gamesPlayed: 0,
    positionsChecked: 0,
    puzzlesFound: 0,
    totalTimeMs: 0,
    totalNodes: 0,
  };

  for (let game = 0; game < maxGames && puzzles.length < count; game += 1) {
    const pos = playRandomGame(size, rng, maxMovesPerGame);
    stats.gamesPlayed += 1;

    // Check positions at various depths in the game.
    // Replay the game, checking at each ply after minStones.
    const replay = new GogoPosition(size);
    for (let ply = 0; ply < pos.ply && puzzles.length < count; ply += 1) {
      const move = pos.getMoveAt(ply);
      replay.play(move);

      if (replay.stoneCount < minStones) {
        continue;
      }
      if (replay.winner !== EMPTY) {
        break;
      }

      stats.positionsChecked += 1;

      const candidate = validatePuzzlePosition(replay, difficulty, searcher, validationBuffers);
      stats.totalNodes += searcher.nodesSearched;

      if (candidate !== null && !seenEncodings.has(candidate.encoded)) {
        seenEncodings.add(candidate.encoded);
        puzzles.push(candidate);
        stats.puzzlesFound += 1;

        if (options.onProgress) {
          stats.totalTimeMs = performance.now() - startTime;
          options.onProgress(stats);
        }
      }
    }

    if ((game + 1) % 1000 === 0 && options.onProgress) {
      stats.totalTimeMs = performance.now() - startTime;
      options.onProgress(stats);
    }
  }

  stats.totalTimeMs = performance.now() - startTime;
  return { puzzles, stats };
}
