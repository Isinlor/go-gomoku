import { BLACK, EMPTY, GogoPosition, type Cell, type Player, WHITE } from './gogomoku';

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  timedOut: boolean;
}

export interface GogoAIOptions {
  maxDepth?: number;
  quiescenceDepth?: number;
  maxPly?: number;
  now?: () => number;
}

export interface GogoMCTSOptions {
  exploration?: number;
  rolloutMaxMoves?: number;
  biasStrength?: number;
  seed?: number;
  now?: () => number;
}

const WIN_SCORE = 1_000_000_000;
const ATTACK_WEIGHTS = [0, 12, 72, 540, 8_000, 500_000] as const;
const DEFENSE_WEIGHTS = [0, 16, 96, 720, 100_000, 500_000] as const;
const EVAL_WEIGHTS = [0, 6, 32, 240, 5_000, WIN_SCORE >> 2] as const;
const LOCAL_LIBERTY_WEIGHTS = [-200, -80, 20, 60, 80] as const;
const TACTICAL_PATTERN_THRESHOLD = ATTACK_WEIGHTS[4];
const CENTER_MULTIPLIER = 3;
const HINT_BONUS = 10_000_000;
const HISTORY_SCALE = 1;
const CAPTURE_BONUS = 5_000;
const ESCAPE_BONUS = 3_500;
const NO_SCORE = Number.NEGATIVE_INFINITY;

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

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
  private scorerGroupMarks = new Uint32Array(0);
  private scorerGroupEpoch = 1;
  private bufferArea = 0;
  private deadline = 0;
  private nodesVisited = 0;
  private timedOut = false;
  private readonly timeoutSignal = new Error('SEARCH_TIMEOUT');

  constructor(options: GogoAIOptions = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 6);
    this.quiescenceDepth = Math.max(0, options.quiescenceDepth ?? 6);
    this.maxPly = Math.max(2, options.maxPly ?? 64);
    this.now = options.now ?? (() => performance.now());
  }

  findBestMove(position: GogoPosition, timeLimitMs: number): SearchResult {
    this.ensureBuffers(position.area);
    this.history.fill(0);
    this.deadline = this.now() + Math.max(0, timeLimitMs);
    this.nodesVisited = 0;
    this.timedOut = false;

    if (position.winner !== EMPTY) {
      return { move: -1, score: -WIN_SCORE, depth: 0, nodes: 0, timedOut: false };
    }

    const fallbackMove = this.pickFallbackMove(position);
    if (fallbackMove === -1 || this.now() >= this.deadline) {
      return { move: fallbackMove, score: 0, depth: 0, nodes: 0, timedOut: fallbackMove !== -1 };
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
    this.scorerGroupMarks = new Uint32Array(area);
    this.scorerGroupEpoch = 1;
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
      return { move: -1, score: 0, depth, nodes: this.nodesVisited, timedOut: false };
    }
    return { move: bestMove, score: bestScore, depth, nodes: this.nodesVisited, timedOut: false };
  }

  private search(position: GogoPosition, depth: number, alpha: number, beta: number, ply: number): number {
    this.checkTime(false);
    if (position.winner !== EMPTY) {
      return -WIN_SCORE + ply;
    }
    if (depth === 0 || ply >= this.maxPly) {
      return this.quiescence(position, alpha, beta, ply, this.quiescenceDepth);
    }

    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    let count = this.generateOrderedMoves(position, moves, scores, -1, false);
    let usedFullBoard = false;
    let legalCount = 0;
    let bestScore = -WIN_SCORE;

    for (;;) {
      for (let i = 0; i < count; i += 1) {
        const move = moves[i];
        if (!position.play(move)) {
          continue;
        }
        legalCount += 1;
        let score = 0;
        try {
          score = -this.search(position, depth - 1, -beta, -alpha, ply + 1);
        } finally {
          position.undo();
        }
        if (score > bestScore) {
          bestScore = score;
        }
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.history[(position.toMove - 1) * this.bufferArea + move] += depth * depth * HISTORY_SCALE;
            return score;
          }
        }
      }
      if (legalCount !== 0 || usedFullBoard) {
        break;
      }
      count = this.generateFullBoardMoves(position, moves, scores, -1, false);
      usedFullBoard = true;
    }

    return legalCount === 0 ? 0 : bestScore;
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
      let black = 0;
      let white = 0;
      for (let step = 0; step < 5; step += 1) {
        const cell = board[windows[base + step]];
        black += cell === BLACK ? 1 : 0;
        white += cell === WHITE ? 1 : 0;
      }
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
        const score = this.scoreMove(position, move, hintMove, tacticalOnly);
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
  ): number {
    let count = 0;
    for (let move = 0; move < position.area; move += 1) {
      if (position.board[move] !== EMPTY || move === position.koPoint) {
        continue;
      }
      const score = this.scoreMove(position, move, hintMove, tacticalOnly);
      if (score === NO_SCORE) {
        continue;
      }
      this.insertMove(moves, scores, count, move, score);
      count += 1;
    }
    return count;
  }

  private scoreMove(position: GogoPosition, move: number, hintMove: number, tacticalOnly: boolean): number {
    const player = position.toMove;
    const opponent = otherPlayer(player);
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
      let mine = 0;
      let theirs = 0;
      for (let step = 0; step < 5; step += 1) {
        const cell = board[windows[base + step]];
        mine += cell === player ? 1 : 0;
        theirs += cell === opponent ? 1 : 0;
      }
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
}

interface MCTSNode {
  parent: MCTSNode | null;
  move: number;
  wins: number;
  visits: number;
  playerToMove: Player;
  playerJustMoved: Cell;
  prior: number;
  untriedMoves: Int16Array | null;
  untriedCount: number;
  children: MCTSNode[];
}

export class GogoMCTS {
  readonly exploration: number;
  readonly rolloutMaxMoves: number;
  readonly biasStrength: number;

  private readonly now: () => number;
  private rngState: number;
  private moveBuffer = new Int16Array(0);
  private scoreBuffer = new Int32Array(0);
  private nodesVisited = 0;

  constructor(options: GogoMCTSOptions = {}) {
    this.exploration = Math.max(0.01, options.exploration ?? 1.2);
    this.rolloutMaxMoves = Math.max(1, options.rolloutMaxMoves ?? 28);
    this.biasStrength = Math.max(0, options.biasStrength ?? 0.35);
    this.now = options.now ?? (() => performance.now());
    this.rngState = (options.seed ?? 1) >>> 0;
  }

  findBestMove(position: GogoPosition, timeLimitMs: number): SearchResult {
    this.ensureBuffers(position.area);
    this.nodesVisited = 0;
    if (position.winner !== EMPTY) {
      return { move: -1, score: -WIN_SCORE, depth: 0, nodes: 0, timedOut: false };
    }

    const immediateWin = this.findImmediateWin(position, position.toMove);
    if (immediateWin !== -1) {
      return { move: immediateWin, score: WIN_SCORE, depth: 1, nodes: 1, timedOut: false };
    }
    const forcedBlock = this.findImmediateWin(position, otherPlayer(position.toMove));
    if (forcedBlock !== -1 && position.isLegal(forcedBlock)) {
      return { move: forcedBlock, score: WIN_SCORE >> 1, depth: 1, nodes: 1, timedOut: false };
    }

    const fallback = this.pickFallbackMove(position);
    if (fallback === -1) {
      return { move: -1, score: 0, depth: 0, nodes: 0, timedOut: false };
    }

    const deadline = this.now() + Math.max(0, timeLimitMs);
    const root: MCTSNode = {
      parent: null,
      move: -1,
      wins: 0,
      visits: 0,
      playerToMove: position.toMove,
      playerJustMoved: EMPTY,
      prior: 0,
      untriedMoves: null,
      untriedCount: 0,
      children: [],
    };

    let iterations = 0;
    while (this.now() < deadline) {
      let node = root;
      const path: MCTSNode[] = [root];
      let plies = 0;

      // Selection + expansion
      while (true) {
        if (position.winner !== EMPTY) {
          break;
        }

        this.expandNodeIfNeeded(node, position);

        if (node.untriedCount > 0) {
          const move = this.popBiasedUntriedMove(node, position);
          const mover = position.toMove;
          const prior = this.normalizeThreat(this.evaluateThreat(position, move, mover));

          if (!position.play(move)) {
            continue;
          }

          plies += 1;

          const child: MCTSNode = {
            parent: node,
            move,
            wins: 0,
            visits: 0,
            playerToMove: position.toMove,
            playerJustMoved: mover,
            prior,
            untriedMoves: null,
            untriedCount: 0,
            children: [],
          };

          node.children.push(child);
          node = child;
          path.push(node);
          break;
        }

        if (node.children.length === 0) {
          break;
        }

        const next = this.selectChild(node);
        if (!position.play(next.move)) {
          break;
        }

        plies += 1;
        node = next;
        path.push(node);
      }

      const winner = position.winner !== EMPTY ? position.winner : this.rollout(position);
      this.nodesVisited += 1;

      for (let i = 0; i < path.length; i += 1) {
        const current = path[i];
        current.visits += 1;
        if (winner === EMPTY) {
          current.wins += 0.5;
        } else if (current.playerJustMoved !== EMPTY && winner === current.playerJustMoved) {
          current.wins += 1;
        }
      }

      while (plies > 0) {
        position.undo();
        plies -= 1;
      }
      iterations += 1;
    }

    if (root.children.length === 0) {
      return { move: fallback, score: 0, depth: 0, nodes: this.nodesVisited, timedOut: true };
    }
    let best = root.children[0];
    for (let i = 1; i < root.children.length; i += 1) {
      const child = root.children[i];
      if (child.visits > best.visits) {
        best = child;
      } else if (child.visits === best.visits) {
        const childRate = child.visits === 0 ? 0 : child.wins / child.visits;
        const bestRate = best.visits === 0 ? 0 : best.wins / best.visits;
        if (childRate > bestRate) {
          best = child;
        }
      }
    }
    const score = best.visits === 0 ? 0 : Math.round((best.wins / best.visits) * 100_000);
    return { move: best.move, score, depth: iterations, nodes: this.nodesVisited, timedOut: this.now() >= deadline };
  }

  private ensureBuffers(area: number): void {
    if (this.moveBuffer.length < area) {
      this.moveBuffer = new Int16Array(area);
      this.scoreBuffer = new Int32Array(area);
    }
  }

  private pickFallbackMove(position: GogoPosition): number {
    if (position.stoneCount === 0) {
      return position.index(position.size >> 1, position.size >> 1);
    }

    const count = position.generateAllLegalMoves(this.moveBuffer);
    if (count === 0) {
      return -1;
    }

    let bestMove = this.moveBuffer[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i += 1) {
      const move = this.moveBuffer[i];
      const score = this.evaluateThreat(position, move, position.toMove) + position.meta.centerBias[move];
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  private expandNodeIfNeeded(node: MCTSNode, position: GogoPosition): void {
    if (node.untriedMoves !== null) {
      return;
    }
    const count = position.generateAllLegalMoves(this.moveBuffer);
    const localMoves = new Int16Array(count);
    localMoves.set(this.moveBuffer.subarray(0, count));
    node.untriedMoves = localMoves;
    node.untriedCount = count;
  }

  private popBiasedUntriedMove(node: MCTSNode, position: GogoPosition): number {
    const moves = node.untriedMoves!;
    let totalWeight = 0;

    for (let i = 0; i < node.untriedCount; i += 1) {
      const move = moves[i];
      const prior = this.normalizeThreat(this.evaluateThreat(position, move, position.toMove));
      const weight = this.threatWeight(prior);
      this.scoreBuffer[i] = weight;
      totalWeight += weight;
    }

    let threshold = this.random() * Math.max(1, totalWeight);
    let chosenIndex = node.untriedCount - 1;

    for (let i = 0; i < node.untriedCount; i += 1) {
      threshold -= this.scoreBuffer[i];
      if (threshold <= 0) {
        chosenIndex = i;
        break;
      }
    }

    const chosen = moves[chosenIndex];
    moves[chosenIndex] = moves[node.untriedCount - 1];
    node.untriedCount -= 1;
    return chosen;
  }

  private selectChild(node: MCTSNode): MCTSNode {
    const logParent = Math.log(node.visits + 1);
    let best = node.children[0];
    let bestValue = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      const exploitation = child.visits === 0 ? 0.5 : child.wins / child.visits;
      const exploration =
        child.visits === 0
          ? this.exploration
          : this.exploration * Math.sqrt(logParent / child.visits);
      const progressiveBias = (this.biasStrength * child.prior) / (child.visits + 1);
      const uct = exploitation + exploration + progressiveBias;

      if (uct > bestValue) {
        bestValue = uct;
        best = child;
      }
    }

    return best;
  }

  private rollout(position: GogoPosition): Cell {
    let plies = 0;
    while (position.winner === EMPTY && plies < this.rolloutMaxMoves) {
      const count = position.generateAllLegalMoves(this.moveBuffer);
      if (count === 0) {
        break;
      }
      const move = this.pickBiasedRolloutMove(position, count);
      if (!position.play(move)) {
        break;
      }
      plies += 1;
    }
    const winner = position.winner;
    while (plies > 0) {
      position.undo();
      plies -= 1;
    }
    return winner;
  }

  private pickBiasedRolloutMove(position: GogoPosition, count: number): number {
    const player = position.toMove;
    let totalWeight = 0;

    for (let i = 0; i < count; i += 1) {
      const move = this.moveBuffer[i];

      if (position.play(move)) {
        const isImmediateWin = position.winner === player;
        position.undo();
        if (isImmediateWin) {
          return move;
        }
      }

      const prior = this.normalizeThreat(this.evaluateThreat(position, move, player));
      const weight = this.threatWeight(prior);
      this.scoreBuffer[i] = weight;
      totalWeight += weight;
    }

    let threshold = this.random() * Math.max(1, totalWeight);
    for (let i = 0; i < count; i += 1) {
      threshold -= this.scoreBuffer[i];
      if (threshold <= 0) {
        return this.moveBuffer[i];
      }
    }

    return this.moveBuffer[count - 1];
  }

  private evaluateThreat(position: GogoPosition, move: number, player: Player): number {
    const opponent = otherPlayer(player);
    const meta = position.meta;
    const board = position.board;
    let score = 1;
    for (let cursor = meta.windowsByPointOffsets[move]; cursor < meta.windowsByPointOffsets[move + 1]; cursor += 1) {
      const windowIndex = meta.windowsByPoint[cursor];
      const base = windowIndex * 5;
      let mine = 0;
      let theirs = 0;
      for (let i = 0; i < 5; i += 1) {
        const cell = board[meta.windows[base + i]];
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
    return score;
  }

  private normalizeThreat(raw: number): number {
    if (raw <= 0) {
      return 0;
    }
    return Math.min(1, Math.log1p(raw) / 14);
  }

  private threatWeight(normalizedThreat: number): number {
    return 1 + Math.floor(256 * (1 + (3 * this.biasStrength * normalizedThreat)));
  }

  private findImmediateWin(position: GogoPosition, player: Player): number {
    const originalToMove = position.toMove;
    position.toMove = player;
    const count = position.generateAllLegalMoves(this.moveBuffer);
    for (let i = 0; i < count; i += 1) {
      const move = this.moveBuffer[i];
      if (!position.play(move)) {
        continue;
      }
      const won = position.winner === player;
      position.undo();
      if (won) {
        position.toMove = originalToMove;
        return move;
      }
    }
    position.toMove = originalToMove;
    return -1;
  }

  private random(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x1_0000_0000;
  }
}
