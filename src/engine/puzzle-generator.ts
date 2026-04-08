import { BLACK, EMPTY, GogoPosition, WHITE, decodeGame, encodeMove } from './gogomoku';
import type { Player } from './gogomoku';
import { BoardUniquenessChecker } from './uniqueness';
import type { Puzzle } from './puzzles';
import { GogoAI } from './ai';

const MAX_BOUNDED_MEMO_ENTRIES = 200_000;

type Difficulty = Readonly<{ depth: number; threshold: number }>;

export type ValidationStage =
  | 'input'
  | 'unique-solution'
  | 'strict-failure'
  | 'threshold'
  | 'not-obvious'
  | 'realistic-history';

export interface ProofStats {
  nodesVisited: number;
  cacheHits: number;
  heuristicLeafCount: number;
}

export interface CandidateValidationOptions extends Difficulty {
  solutionMove: number;
  checkNotObvious?: boolean;
  checkRealisticHistory?: boolean;
  notObviousTimeMs?: number;
  proofHorizon?: number;
}

export interface CandidateValidationResult extends Difficulty {
  valid: boolean;
  stage: ValidationStage | 'ok';
  reason: string;
  solutionMove: number;
  solutionMoveText: string;
  proofStats: ProofStats;
}

interface ProofContext {
  boundedMemo: Map<string, boolean>;
  stats: ProofStats;
}

interface BuildPuzzleOptions extends Difficulty {
  id: string;
  solutionMove: number;
}

function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

function createProofContext(): ProofContext {
  return {
    boundedMemo: new Map<string, boolean>(),
    stats: {
      nodesVisited: 0,
      cacheHits: 0,
      heuristicLeafCount: 0,
    },
  };
}

function stateKey(position: GogoPosition, target: Player): string {
  // Includes all rule-relevant fields for deterministic, exact game-theoretic proof.
  let key = `${target}|${position.toMove}|${position.koPoint}|${position.winner}|`;
  for (let i = 0; i < position.area; i += 1) {
    key += String.fromCharCode(48 + position.board[i]);
  }
  return key;
}

function stateKeyBounded(position: GogoPosition, target: Player, remaining: number): string {
  return `${remaining}|${stateKey(position, target)}`;
}

function hasForcedWinWithinInternal(
  position: GogoPosition,
  target: Player,
  remainingPlies: number,
  proof: ProofContext,
): boolean {
  proof.stats.nodesVisited += 1;
  if (position.winner !== EMPTY) {
    return position.winner === target;
  }
  if (remainingPlies <= 0) {
    return false;
  }

  const key = stateKeyBounded(position, target, remainingPlies);
  const cached = proof.boundedMemo.get(key);
  if (cached !== undefined) {
    proof.stats.cacheHits += 1;
    return cached;
  }
  if (proof.boundedMemo.size > MAX_BOUNDED_MEMO_ENTRIES) {
    proof.boundedMemo.clear();
  }

  const legal = new Int16Array(position.area);
  const legalCount = position.generateAllLegalMoves(legal);
  if (legalCount === 0) {
    proof.boundedMemo.set(key, false);
    return false;
  }

  let result = false;
  if (position.toMove === target) {
    for (let i = 0; i < legalCount; i += 1) {
      const move = legal[i];
      if (!position.play(move)) {
        continue;
      }
      const child = hasForcedWinWithinInternal(position, target, remainingPlies - 1, proof);
      position.undo();
      if (child) {
        result = true;
        break;
      }
    }
  } else {
    result = true;
    for (let i = 0; i < legalCount; i += 1) {
      const move = legal[i];
      if (!position.play(move)) {
        continue;
      }
      const child = hasForcedWinWithinInternal(position, target, remainingPlies - 1, proof);
      position.undo();
      if (!child) {
        result = false;
        break;
      }
    }
  }

  proof.boundedMemo.set(key, result);
  return result;
}

export function forcedWinDistance(position: GogoPosition, target: Player, maxPlies = 10): number | null {
  const proof = createProofContext();
  if (position.winner === target) {
    return 0;
  }
  for (let plies = 1; plies <= maxPlies; plies += 1) {
    if (!hasForcedWinWithinInternal(position, target, plies, proof)) {
      continue;
    }
    if (plies === 1 || !hasForcedWinWithinInternal(position, target, plies - 1, proof)) {
      return plies;
    }
  }
  return null;
}

export function hasForcedWinWithin(position: GogoPosition, target: Player, maxPlies: number): boolean {
  const proof = createProofContext();
  return hasForcedWinWithinInternal(position, target, maxPlies, proof);
}

export function validatePuzzleCandidate(
  position: GogoPosition,
  options: CandidateValidationOptions,
): CandidateValidationResult {
  const proof = createProofContext();
  const depth = Math.max(1, options.depth);
  const threshold = Math.max(1, options.threshold);
  const solutionMove = options.solutionMove;
  const solutionMoveText = encodeMove(solutionMove, position.meta);
  const checkNotObvious = options.checkNotObvious ?? true;
  const checkRealisticHistory = options.checkRealisticHistory ?? true;
  const proofHorizon = Math.max(depth, threshold, options.proofHorizon ?? 12);

  if (solutionMove < 0 || solutionMove >= position.area || !position.isLegal(solutionMove)) {
    return {
      valid: false,
      stage: 'input',
      reason: 'Solution move must be a legal move in the candidate position.',
      solutionMove,
      solutionMoveText,
      depth,
      threshold,
      proofStats: proof.stats,
    };
  }

  const legal = new Int16Array(position.area);
  const legalCount = position.generateAllLegalMoves(legal);
  const mover = position.toMove;
  const opponent = otherPlayer(mover);
  let solutionSeen = false;

  for (let i = 0; i < legalCount; i += 1) {
    const move = legal[i];
    if (!position.play(move)) {
      continue;
    }
    if (move === solutionMove) {
      const canWinInDepth = hasForcedWinWithinInternal(position, mover, depth - 1, proof);
      const canWinFaster = depth > 1
        ? hasForcedWinWithinInternal(position, mover, depth - 2, proof)
        : false;
      position.undo();
      if (!canWinInDepth || canWinFaster) {
        return {
          valid: false,
          stage: 'unique-solution',
          reason: `Solution must force win in exactly ${depth} plies.`,
          solutionMove,
          solutionMoveText,
          depth,
          threshold,
          proofStats: proof.stats,
        };
      }
      solutionSeen = true;
      continue;
    }

    const ownCanForceFastWin = hasForcedWinWithinInternal(position, mover, depth - 1, proof);
    if (ownCanForceFastWin) {
      position.undo();
      return {
        valid: false,
        stage: 'unique-solution',
        reason: 'Another legal move also forces a win for the mover.',
        solutionMove,
        solutionMoveText,
        depth,
        threshold,
        proofStats: proof.stats,
      };
    }

    const opponentTooFast = threshold > 1
      ? hasForcedWinWithinInternal(position, opponent, threshold - 1, proof)
      : false;
    if (opponentTooFast) {
      position.undo();
      return {
        valid: false,
        stage: 'threshold',
        reason: `A losing branch allows opponent forced win in fewer than ${threshold} plies.`,
        solutionMove,
        solutionMoveText,
        depth,
        threshold,
        proofStats: proof.stats,
      };
    }
    const opponentEventuallyWins = hasForcedWinWithinInternal(position, opponent, proofHorizon - 1, proof);
    position.undo();
    if (!opponentEventuallyWins) {
      return {
        valid: false,
        stage: 'strict-failure',
        reason: 'A losing branch does not force an eventual opponent win.',
        solutionMove,
        solutionMoveText,
        depth,
        threshold,
        proofStats: proof.stats,
      };
    }
  }

  if (!solutionSeen) {
    return {
      valid: false,
      stage: 'input',
      reason: 'Solution move was not found among legal moves.',
      solutionMove,
      solutionMoveText,
      depth,
      threshold,
      proofStats: proof.stats,
    };
  }

  if (checkNotObvious) {
    const depth1 = new GogoAI({ maxDepth: 1, quiescenceDepth: 0, maxPly: 32 });
    const topMove = depth1.findBestMove(position, Math.max(10, options.notObviousTimeMs ?? 200)).move;
    if (topMove === solutionMove) {
      return {
        valid: false,
        stage: 'not-obvious',
        reason: 'Depth-1 classic AI already prefers the puzzle solution.',
        solutionMove,
        solutionMoveText,
        depth,
        threshold,
        proofStats: proof.stats,
      };
    }
  }

  if (checkRealisticHistory) {
    const replay = new GogoPosition(position.size);
    for (let ply = 0; ply < position.ply; ply += 1) {
      if (hasForcedWinWithinInternal(replay, replay.toMove, 3, proof)) {
        return {
          valid: false,
          stage: 'realistic-history',
          reason: 'Game history contains an earlier forced win in 3 plies or fewer.',
          solutionMove,
          solutionMoveText,
          depth,
          threshold,
          proofStats: proof.stats,
        };
      }
      replay.play(position.getMoveAt(ply));
    }
  }

  return {
    valid: true,
    stage: 'ok',
    reason: 'Candidate satisfies all puzzle constraints.',
    solutionMove,
    solutionMoveText,
    depth,
    threshold,
    proofStats: proof.stats,
  };
}

export function createPuzzleFromPosition(position: GogoPosition, options: BuildPuzzleOptions): Puzzle {
  return {
    id: options.id,
    encoded: position.encodeGame(),
    toMove: position.toMove,
    solution: encodeMove(options.solutionMove, position.meta),
    depth: options.depth,
    threshold: options.threshold,
  };
}

export interface PuzzleGeneratorOptions extends Difficulty {
  targetCount: number;
  seed?: number;
  boardSize?: 9 | 11 | 13;
  maxMovesPlayed?: number;
  maxGames?: number;
  randomOpeningPlies?: number;
  minCandidatePly?: number;
  maxEmptyCellsForCandidates?: number;
}

export interface GeneratedPuzzle extends Puzzle {
  proofStats: ProofStats;
}

function nextRandom(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

export function generatePuzzlesFromSelfPlay(
  options: PuzzleGeneratorOptions,
  knownPuzzles: readonly Puzzle[] = [],
): GeneratedPuzzle[] {
  const boardSize = options.boardSize ?? 9;
  const maxMoves = Math.max(1, options.maxMovesPlayed ?? 60);
  const maxGames = Math.max(1, options.maxGames ?? 300);
  const randomOpeningPlies = Math.max(0, options.randomOpeningPlies ?? 8);
  const minCandidatePly = Math.max(0, options.minCandidatePly ?? 40);
  const maxEmptyCells = Math.max(1, options.maxEmptyCellsForCandidates ?? 24);
  const shallow = new GogoAI({ maxDepth: 2, quiescenceDepth: 2, maxPly: 48 });
  const deep = new GogoAI({ maxDepth: 4, quiescenceDepth: 1, maxPly: 64 });
  const accepted: GeneratedPuzzle[] = [];
  const seenRecords = new Set<string>(knownPuzzles.map((p) => p.encoded));
  const knownPositions = knownPuzzles.map((p) => decodeGame(p.encoded));

  let rng = options.seed ?? 1;
  for (let game = 0; game < maxGames && accepted.length < options.targetCount; game += 1) {
    const position = new GogoPosition(boardSize);
    while (position.winner === EMPTY && position.ply < maxMoves) {
      if (position.ply >= minCandidatePly && (position.area - position.stoneCount) <= maxEmptyCells) {
        const candidateMove = deep.findBestMove(position, 80).move;
        const shallowMove = shallow.findBestMove(position, 80).move;
        if (candidateMove !== -1 && shallowMove !== candidateMove && position.isLegal(candidateMove)) {
          const mover = position.toMove;
          const proof = createProofContext();
          position.play(candidateMove);
          const winsInDepth = hasForcedWinWithinInternal(position, mover, Math.max(0, options.depth - 1), proof);
          const winsFaster = options.depth > 1
            ? hasForcedWinWithinInternal(position, mover, options.depth - 2, proof)
            : false;
          position.undo();
          if (!winsInDepth || winsFaster) {
            continue;
          }
          const validation = validatePuzzleCandidate(position, {
            depth: options.depth,
            threshold: options.threshold,
            solutionMove: candidateMove,
            proofHorizon: Math.max(options.depth, options.threshold) + 2,
          });
          if (validation.valid) {
            const id = `generated-${options.depth}-${options.threshold}-${accepted.length + 1}`;
            const puzzle = createPuzzleFromPosition(position, {
              id,
              solutionMove: candidateMove,
              depth: options.depth,
              threshold: options.threshold,
            });
            if (!seenRecords.has(puzzle.encoded)) {
              const uniquenessChecker = new BoardUniquenessChecker(
                [...knownPositions, ...accepted.map((p) => decodeGame(p.encoded))],
                maxMoves,
              );
              if (uniquenessChecker.isUnique(position)) {
                seenRecords.add(puzzle.encoded);
                accepted.push({
                  ...puzzle,
                  proofStats: validation.proofStats,
                });
                if (accepted.length >= options.targetCount) {
                  break;
                }
              }
            }
          }
        }
      }

      let move = -1;
      if (position.ply < randomOpeningPlies) {
        const legal = new Int16Array(position.area);
        const legalCount = position.generateAllLegalMoves(legal);
        if (legalCount === 0) {
          break;
        }
        rng = nextRandom(rng);
        move = legal[rng % legalCount];
      } else {
        move = shallow.findBestMove(position, 80).move;
      }
      if (move === -1 || !position.play(move)) {
        break;
      }
    }
  }

  return accepted;
}
