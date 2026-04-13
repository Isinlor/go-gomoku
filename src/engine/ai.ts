import { BLACK, EMPTY, GogoPosition, type Cell, type Player, WHITE } from './gogomoku';

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  timedOut: boolean;
  forcedWin: boolean;
  forcedLoss: boolean;
}

export interface GogoAIOptions {
  maxDepth?: number;
  quiescenceDepth?: number;
  maxPly?: number;
  now?: () => number;
  useTranspositionTable?: boolean;
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
const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;
const MATE_BAND = 2048;

interface TTProbeResult {
  cutoff: boolean;
  score: number;
}

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

export class GogoAI {
  readonly maxDepth: number;
  readonly quiescenceDepth: number;
  readonly maxPly: number;
  readonly useTranspositionTable: boolean;

  private readonly now: () => number;
  private moveBuffers: Int16Array[] = [];
  private scoreBuffers: Int32Array[] = [];
  private history = new Int32Array(0);
  private candidateMarks = new Uint32Array(0);
  private candidateEpoch = 1;
  private scorerGroupMarks = new Uint32Array(0);
  private scorerGroupEpoch = 1;
  private bufferArea = 0;
  private deadline = 0;
  private nodesVisited = 0;
  private timedOut = false;
  private killerMoves = new Int16Array(0);
  private readonly timeoutSignal = new Error('SEARCH_TIMEOUT');
  private ttMask = 0;
  private ttKeyLo = new Uint32Array(0);
  private ttKeyHi = new Uint32Array(0);
  private ttDepth = new Int16Array(0);
  private ttScore = new Int32Array(0);
  private ttMove = new Int16Array(0);
  private ttFlag = new Uint8Array(0);

  constructor(options: GogoAIOptions = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 6);
    this.quiescenceDepth = Math.max(0, options.quiescenceDepth ?? 6);
    this.maxPly = Math.max(2, options.maxPly ?? 64);
    this.useTranspositionTable = options.useTranspositionTable ?? true;
    this.now = options.now ?? (() => performance.now());
    this.initTranspositionTable();
  }

  findBestMove(position: GogoPosition, timeLimitMs: number): SearchResult {
    this.ensureBuffers(position.area);
    this.history.fill(0);
    this.killerMoves.fill(-1);
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;
    this.clearTranspositionTable();

    if (position.winner !== EMPTY) {
      return {
        move: -1,
        score: -WIN_SCORE,
        depth: 0,
        nodes: 0,
        timedOut: false,
        forcedWin: false,
        forcedLoss: true,
      };
    }

    const fallbackMove = this.pickFallbackMove(position);
    if (fallbackMove === -1 || this.now() >= this.deadline) {
      return {
        move: fallbackMove,
        score: 0,
        depth: 0,
        nodes: 0,
        timedOut: fallbackMove !== -1,
        forcedWin: false,
        forcedLoss: false,
      };
    }

    let bestMove = fallbackMove;
    let bestScore = 0;
    let completedDepth = 0;
    let hintMove = fallbackMove;
    const startPly = position.ply;

    for (let depth = 1; depth <= this.maxDepth; depth += 1) {
      try {
        const result = this.searchRoot(position, depth, hintMove);
        if (result.move !== -1) {
          bestMove = result.move;
          bestScore = result.score;
          hintMove = result.move;
          completedDepth = depth;
          if (this.isForcedWinScore(result.score, depth) || this.isForcedLossScore(result.score, depth)) {
            break;
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

    return {
      move: bestMove,
      score: bestScore,
      depth: completedDepth,
      nodes: this.nodesVisited,
      timedOut: this.timedOut,
      forcedWin: this.isForcedWinScore(bestScore, completedDepth),
      forcedLoss: this.isForcedLossScore(bestScore, completedDepth),
    };
  }

  private initTranspositionTable(): void {
    const entries = 1 << 19;
    this.ttMask = entries - 1;
    this.ttKeyLo = new Uint32Array(entries);
    this.ttKeyHi = new Uint32Array(entries);
    this.ttDepth = new Int16Array(entries);
    this.ttScore = new Int32Array(entries);
    this.ttMove = new Int16Array(entries);
    this.ttMove.fill(-1);
    this.ttFlag = new Uint8Array(entries);
  }

  private clearTranspositionTable(): void {
    if (!this.useTranspositionTable) {
      return;
    }
    this.ttDepth.fill(0);
    this.ttMove.fill(-1);
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
    this.scorerGroupMarks = new Uint32Array(area);
    this.scorerGroupEpoch = 1;
    this.killerMoves = new Int16Array((this.maxPly + 1) * 2);
    this.killerMoves.fill(-1);
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

  private searchRoot(position: GogoPosition, depth: number, hintMove: number): SearchResult {
    this.checkTime(true);
    const moves = this.moveBuffers[0];
    const scores = this.scoreBuffers[0];
    let count = this.generateOrderedMoves(position, moves, scores, hintMove, false);
    let usedFullBoard = false;
    let alpha = -WIN_SCORE;
    const beta = WIN_SCORE;
    let bestMove = -1;
    let bestScore = -WIN_SCORE;
    let legalCount = 0;

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
        break;
      }
      count = this.generateFullBoardMoves(position, moves, scores, hintMove, false);
      usedFullBoard = true;
    }

    if (legalCount === 0) {
      return { move: -1, score: 0, depth, nodes: this.nodesVisited, timedOut: false, forcedWin: false, forcedLoss: false };
    }
    return { move: bestMove, score: bestScore, depth, nodes: this.nodesVisited, timedOut: false, forcedWin: false, forcedLoss: false };
  }

  private search(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number, canNullMove = true): number {
    this.checkTime(false);
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }
    if (depth <= 0 || ply >= this.maxPly) {
      return this.quiescence(position, alpha, beta, ply, this.quiescenceDepth);
    }

    const alphaOriginal = alpha;
    const ttProbe = this.probeTT(position, depth, alpha, beta, ply);
    if (ttProbe.cutoff) {
      return ttProbe.score;
    }

    // Null move pruning: if we give the opponent a free move and they still
    // can't beat beta, the position is likely good enough to prune.
    if (depth >= 3 && canNullMove) {
      const nullState = position.applyNullMoveForSearch();
      let nullScore: number;
      try {
        nullScore = -this.search(position, depth - 3, -beta, -beta + 1, ply + 1, false);
      } finally {
        position.undoNullMoveForSearch(nullState);
      }
      if (nullScore >= beta) {
        return beta;
      }
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = this.generateOrderedMoves(position, moves, scores, -1, false, ply);
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
            // PVS: zero-window scout search for subsequent moves
            score = -this.search(position, depth - 1, -alpha - 1, -alpha, ply + 1);
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
            this.storeTT(position, depth, score, TT_LOWER, move, ply);
            return score;
          }
        }
      }
      if (legalCount !== 0 || usedFullBoard) {
        break;
      }
      count = this.generateFullBoardMoves(position, moves, scores, -1, false, ply);
      usedFullBoard = true;
    }

    if (legalCount === 0) {
      this.storeTT(position, depth, 0, TT_EXACT, -1, ply);
      return 0;
    }

    const flag = bestScore <= alphaOriginal ? TT_UPPER : TT_EXACT;
    this.storeTT(position, depth, bestScore, flag, bestMove, ply);
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
        this.insertMove(moves, scores, count, move, score);
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
    let count = 0;
    for (let move = 0; move < position.area; move += 1) {
      if (position.board[move] !== EMPTY || move === position.koPoint) {
        continue;
      }
      const score = this.scoreMove(position, move, hintMove, tacticalOnly, ply);
      if (score === NO_SCORE) {
        continue;
      }
      this.insertMove(moves, scores, count, move, score);
      count += 1;
    }
    return count;
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
      if (cell === opponent && this.scorerGroupMarks[neighbor] !== this.scorerGroupEpoch) {
        const liberties = position.scanGroup(neighbor, opponent);
        for (let i = 0; i < position.scanGroupSize; i += 1) {
          this.scorerGroupMarks[position.groupBuffer[i]] = this.scorerGroupEpoch;
        }
        if (liberties === 1) {
          capturePressure += CAPTURE_BONUS + (position.scanGroupSize * 300);
        } else if (liberties === 2) {
          capturePressure += position.scanGroupSize * 30;
        }
      } else if (cell === player && this.scorerGroupMarks[neighbor] !== this.scorerGroupEpoch) {
        const liberties = position.scanGroup(neighbor, player);
        for (let i = 0; i < position.scanGroupSize; i += 1) {
          this.scorerGroupMarks[position.groupBuffer[i]] = this.scorerGroupEpoch;
        }
        if (liberties === 1) {
          escapePressure += ESCAPE_BONUS + (position.scanGroupSize * 250);
        } else if (liberties === 2) {
          escapePressure += position.scanGroupSize * 20;
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

  private insertMove(moves: Int16Array, scores: Int32Array, count: number, move: number, score: number): void {
    let index = count;
    while (index > 0 && score > scores[index - 1]) {
      moves[index] = moves[index - 1];
      scores[index] = scores[index - 1];
      index -= 1;
    }
    moves[index] = move;
    scores[index] = score;
  }

  private checkTime(force: boolean): void {
    this.nodesVisited += 1;
    if ((force || (this.nodesVisited & 127) === 0) && this.now() >= this.deadline) {
      throw this.timeoutSignal;
    }
  }

  private probeTT(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number): TTProbeResult {
    if (!this.useTranspositionTable) {
      return { cutoff: false, score: 0 };
    }
    const keyLo = position.hashLo32;
    const keyHi = position.hashHi32;
    const slot = keyLo & this.ttMask;
    if (this.ttKeyLo[slot] !== keyLo || this.ttKeyHi[slot] !== keyHi || this.ttDepth[slot] < depth) {
      return { cutoff: false, score: 0 };
    }
    const score = this.ttUnpackScore(this.ttScore[slot], ply);
    const flag = this.ttFlag[slot];
    if (flag === TT_EXACT) {
      return { cutoff: true, score };
    }
    if (flag === TT_LOWER && score >= beta) {
      return { cutoff: true, score };
    }
    if (flag === TT_UPPER && score <= alpha) {
      return { cutoff: true, score };
    }
    return { cutoff: false, score };
  }

  private storeTT(position: GogoPosition, depth: number, score: number, flag: number, move: number, ply: number): void {
    if (!this.useTranspositionTable) {
      return;
    }
    const keyLo = position.hashLo32;
    const keyHi = position.hashHi32;
    const slot = keyLo & this.ttMask;
    const sameKey = this.ttKeyLo[slot] === keyLo && this.ttKeyHi[slot] === keyHi;
    if (sameKey && this.ttDepth[slot] > depth) {
      return;
    }
    this.ttKeyLo[slot] = keyLo;
    this.ttKeyHi[slot] = keyHi;
    this.ttDepth[slot] = depth;
    this.ttScore[slot] = this.ttPackScore(score, ply);
    this.ttFlag[slot] = flag;
    this.ttMove[slot] = move;
  }

  private ttPackScore(score: number, ply: number): number {
    if (score >= WIN_SCORE - MATE_BAND) {
      return score + ply;
    }
    if (score <= -WIN_SCORE + MATE_BAND) {
      return score - ply;
    }
    return score;
  }

  private ttUnpackScore(score: number, ply: number): number {
    if (score >= WIN_SCORE - MATE_BAND) {
      return score - ply;
    }
    if (score <= -WIN_SCORE + MATE_BAND) {
      return score + ply;
    }
    return score;
  }
}
