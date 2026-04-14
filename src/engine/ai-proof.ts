import { BLACK, EMPTY, type GogoPosition, type Player, WHITE } from './gogomoku';

export interface ProofSearchHost {
  maxPly: number;
  moveBuffers: Int16Array[];
  scoreBuffers: Int32Array[];
  candidateMarks: Uint32Array;
  candidateEpoch: number;
  triedMoveMarks: Uint32Array;
  triedMoveEpoch: number;
  scorerGroupMarks: Uint32Array;
  scorerGroupEpoch: number;
  deadline: number;
  nodesVisited: number;
  timedOut: boolean;
  proofTTHash: Int32Array;
  proofTTResult: Int8Array;
  proofTTDepth: Int8Array;
  proofTTBestMove: Int16Array;
  now: () => number;
  timeoutSignal: Error;
  ensureBuffers(area: number): void;
  resetSearchHeuristics(clearTT?: boolean): void;
  checkTime(force: boolean): void;
  generateOrderedMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Int32Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply?: number,
  ): number;
  generateFullBoardMoves(
    position: GogoPosition,
    moves: Int16Array,
    scores: Int32Array,
    hintMove: number,
    tacticalOnly: boolean,
    ply?: number,
  ): number;
  insertOrPromoteMove(
    moves: Int16Array,
    scores: Int32Array,
    count: number,
    move: number,
    score: number,
  ): number;
  proofAttack(position: GogoPosition, depthLeft: number, ply: number): boolean;
  proofDefend(position: GogoPosition, depthLeft: number, ply: number): boolean;
  findThreatResponses(position: GogoPosition, ply: number): number;
}

interface ProofTTProbe {
  result: -1 | 0 | 1;
  ttBest: number;
  ttIdx: number;
}

function probeProofTT(host: ProofSearchHost, hash: number, depthLeft: number, ttMask: number): ProofTTProbe {
  const ttIdx = hash & ttMask;
  let ttBest = -1;
  let result: -1 | 0 | 1 = 0;
  if (host.proofTTHash[ttIdx] === hash) {
    if (host.proofTTDepth[ttIdx] >= depthLeft) {
      result = host.proofTTResult[ttIdx] as -1 | 0 | 1;
    }
    ttBest = host.proofTTBestMove[ttIdx];
  }
  return { result, ttBest, ttIdx };
}

function tryAttackMove(
  host: ProofSearchHost,
  position: GogoPosition,
  move: number,
  depthLeft: number,
  ply: number,
  ttIdx: number,
  hash: number,
  ttMask: number,
): boolean {
  if (!position.play(move)) {
    return false;
  }
  try {
    if (position.winner !== EMPTY || host.proofDefend(position, depthLeft - 1, ply + 1)) {
      storeProofTT(host, ttIdx, hash, depthLeft, 1, move);
      return true;
    }
    return false;
  } finally {
    position.undo();
  }
}

function tryDefenseMove(
  host: ProofSearchHost,
  position: GogoPosition,
  move: number,
  depthLeft: number,
  ply: number,
  ttIdx: number,
  hash: number,
  ttMask: number,
): -1 | 0 | 1 {
  if (!position.play(move)) {
    return -1;
  }
  try {
    if (!(position.winner === EMPTY && host.proofAttack(position, depthLeft - 1, ply + 1))) {
      storeProofTT(host, ttIdx, hash, depthLeft, -1, move);
      return 1;
    }
    return 0;
  } finally {
    position.undo();
  }
}

export function resetProofSearch(host: ProofSearchHost): void {
  host.resetSearchHeuristics();
  host.proofTTHash.fill(0);
  host.proofTTResult.fill(0);
  host.proofTTDepth.fill(0);
  host.proofTTBestMove.fill(-1);
}

export function storeProofTT(
  host: ProofSearchHost,
  ttIdx: number,
  hash: number,
  depthLeft: number,
  result: 1 | -1,
  bestMove?: number,
): void {
  host.proofTTHash[ttIdx] = hash;
  host.proofTTResult[ttIdx] = result;
  host.proofTTDepth[ttIdx] = depthLeft;
  host.proofTTBestMove[ttIdx] = bestMove ?? -1;
}

export function verifyWinningMove(
  host: ProofSearchHost,
  position: GogoPosition,
  move: number,
  timeLimitMs: number,
  ttMask: number,
): boolean {
  host.ensureBuffers(position.area);
  host.deadline = host.now() + Math.max(0, timeLimitMs);
  host.nodesVisited = 0;
  host.timedOut = false;
  resetProofSearch(host);

  if (!position.play(move)) {
    return false;
  }
  try {
    for (let maxDepth = 1; maxDepth <= host.maxPly; maxDepth += 2) {
      try {
        if (host.proofDefend(position, maxDepth, 1)) {
          return true;
        }
      } catch (error) {
        if (error !== host.timeoutSignal) {
          throw error;
        }
        host.timedOut = true;
        return false;
      }
    }
    return false;
  } finally {
    position.undo();
  }
}

export function proofAttack(
  host: ProofSearchHost,
  position: GogoPosition,
  depthLeft: number,
  ply: number,
  ttMask: number,
): boolean {
  host.checkTime(false);
  if (position.winner !== EMPTY || depthLeft <= 0) {
    return false;
  }

  const hash = position.hash;
  const { result, ttBest, ttIdx } = probeProofTT(host, hash, depthLeft, ttMask);
  if (result === 1) return true;
  if (result === -1) return false;

  if (
    ttBest !== -1
    && position.board[ttBest] === EMPTY
    && ttBest !== position.koPoint
    && tryAttackMove(host, position, ttBest, depthLeft, ply, ttIdx, hash, ttMask)
  ) {
    return true;
  }

  const moves = host.moveBuffers[ply];
  const scores = host.scoreBuffers[ply];
  const count = host.generateOrderedMoves(position, moves, scores, -1, true, ply);
  for (let i = 0; i < count; i += 1) {
    const move = moves[i];
    if (move !== ttBest && tryAttackMove(host, position, move, depthLeft, ply, ttIdx, hash, ttMask)) {
      return true;
    }
  }

  storeProofTT(host, ttIdx, hash, depthLeft, -1);
  return false;
}

export function proofDefend(
  host: ProofSearchHost,
  position: GogoPosition,
  depthLeft: number,
  ply: number,
  ttMask: number,
): boolean {
  host.checkTime(false);
  if (position.winner !== EMPTY) return true;
  if (depthLeft <= 0) return false;

  const hash = position.hash;
  const { result, ttBest, ttIdx } = probeProofTT(host, hash, depthLeft, ttMask);
  if (result === 1) return true;
  if (result === -1) return false;

  let anyLegalCount = 0;
  const triedEpoch = host.triedMoveEpoch;
  host.triedMoveEpoch += 1;

  if (ttBest !== -1 && position.board[ttBest] === EMPTY && ttBest !== position.koPoint) {
    host.triedMoveMarks[ttBest] = triedEpoch;
    const ttBestResult = tryDefenseMove(host, position, ttBest, depthLeft, ply, ttIdx, hash, ttMask);
    if (ttBestResult !== -1) {
      anyLegalCount += 1;
    }
    if (ttBestResult === 1) {
      return false;
    }
  }

  const moves = host.moveBuffers[ply];
  const tryMoves = (count: number): { legalCount: number; refuted: boolean } => {
    let legalCount = 0;
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      if (host.triedMoveMarks[move] === triedEpoch) {
        continue;
      }
      host.triedMoveMarks[move] = triedEpoch;
      const result = tryDefenseMove(host, position, move, depthLeft, ply, ttIdx, hash, ttMask);
      if (result === -1) {
        continue;
      }
      anyLegalCount += 1;
      legalCount += 1;
      if (result === 1) {
        return { legalCount, refuted: true };
      }
    }
    return { legalCount, refuted: false };
  };

  const threatResponses = host.findThreatResponses(position, ply);
  if (threatResponses > 0 && tryMoves(threatResponses).refuted) {
    return false;
  }

  const scores = host.scoreBuffers[ply];
  let count = host.generateOrderedMoves(position, moves, scores, -1, false, ply);
  let usedFullBoard = false;
  for (;;) {
    const stage = tryMoves(count);
    if (stage.refuted) {
      return false;
    }
    if (stage.legalCount !== 0 || usedFullBoard) {
      break;
    }
    count = host.generateFullBoardMoves(position, moves, scores, -1, false, ply);
    usedFullBoard = true;
  }

  if (anyLegalCount === 0) {
    return false;
  }
  storeProofTT(host, ttIdx, hash, depthLeft, 1);
  return true;
}

export function findThreatResponses(host: ProofSearchHost, position: GogoPosition, ply: number): number {
  const attacker: Player = position.toMove === BLACK ? WHITE : BLACK;
  const defender = position.toMove;
  const { windows, neighbors4, windowCount } = position.meta;
  const board = position.board;

  host.candidateEpoch += 1;
  const moves = host.moveBuffers[ply];
  const scores = host.scoreBuffers[ply];
  let count = 0;
  let hasThreat = false;

  for (let wi = 0; wi < windowCount; wi += 1) {
    const base = wi * 5;
    let atkCount = 0;
    let defCount = 0;
    let emptyCell = -1;
    for (let j = 0; j < 5; j += 1) {
      const cell = board[windows[base + j]];
      if (cell === attacker) atkCount += 1;
      else if (cell === defender) defCount += 1;
      else emptyCell = windows[base + j];
    }
    if (emptyCell === -1 || emptyCell === position.koPoint) {
      continue;
    }
    if (atkCount === 4 && defCount === 0) {
      hasThreat = true;
      count = host.insertOrPromoteMove(moves, scores, count, emptyCell, 2_000_000);
    }
    if (defCount === 4 && atkCount === 0) {
      count = host.insertOrPromoteMove(moves, scores, count, emptyCell, 3_000_000);
    }
  }

  if (!hasThreat) {
    return -1;
  }

  host.scorerGroupEpoch += 1;
  for (let point = 0; point < position.area; point += 1) {
    if (board[point] !== attacker || host.scorerGroupMarks[point] === host.scorerGroupEpoch) {
      continue;
    }
    const liberties = position.scanGroup(point, attacker);
    for (let gi = 0; gi < position.scanGroupSize; gi += 1) {
      host.scorerGroupMarks[position.groupBuffer[gi]] = host.scorerGroupEpoch;
    }
    if (liberties !== 1) {
      continue;
    }
    for (let gi = 0; gi < position.scanGroupSize; gi += 1) {
      const stone = position.groupBuffer[gi];
      const neighborBase = stone * 4;
      for (let offset = 0; offset < 4; offset += 1) {
        const neighbor = neighbors4[neighborBase + offset];
        if (neighbor !== -1 && board[neighbor] === EMPTY && neighbor !== position.koPoint) {
          count = host.insertOrPromoteMove(moves, scores, count, neighbor, 1_500_000);
        }
      }
    }
  }

  return count;
}
