import { BLACK, WHITE, EMPTY, GogoPosition, encodeMove, parseSupportedSize } from './gogomoku';
import type { SupportedSize } from './gogomoku';
import { DIHEDRAL_TRANSFORMS, computeCanonicalPackedKey } from './uniqueness';
interface SymmetryKeyScratch {
  readonly xs: Int16Array;
  readonly ys: Int16Array;
  readonly colors: Uint8Array;
  readonly packed: Uint16Array;
}

export interface PositionSymmetryOptions {
  includeTranslationSymmetry: boolean;
  includeColorSymmetry: boolean;
}

export interface StreamUniqueBoardsOptions extends PositionSymmetryOptions {
  ply: number;
  boardSize?: SupportedSize;
  maxBoards?: number;
  timeLimitMs?: number;
  seed?: number;
  now?: () => number;
}

export interface StreamUniqueBoardsStats {
  emitted: number;
  exploredNodes: number;
  prunedPrefixes: number;
  truncatedByAmount: boolean;
  truncatedByTime: boolean;
}

const DEFAULT_SEED_STATE = 0x6D2B79F5;
const SYMMETRY_KEY_SCRATCH = new Map<number, SymmetryKeyScratch>();

function getSymmetryKeyScratch(area: number): SymmetryKeyScratch {
  const cached = SYMMETRY_KEY_SCRATCH.get(area);
  if (cached !== undefined) {
    return cached;
  }

  const created: SymmetryKeyScratch = {
    xs: new Int16Array(area),
    ys: new Int16Array(area),
    colors: new Uint8Array(area),
    packed: new Uint16Array(area),
  };
  SYMMETRY_KEY_SCRATCH.set(area, created);
  return created;
}

function collectStoneData(
  position: GogoPosition,
  xs: Int16Array,
  ys: Int16Array,
  colors: Uint8Array,
): number {
  let count = 0;
  for (let index = 0; index < position.area; index += 1) {
    const cell = position.board[index];
    if (cell !== EMPTY) {
      xs[count] = position.meta.xs[index];
      ys[count] = position.meta.ys[index];
      colors[count] = cell;
      count += 1;
    }
  }
  return count;
}

function computePositionSymmetryKeyFast(
  position: GogoPosition,
  options: PositionSymmetryOptions,
): string {
  const scratch = getSymmetryKeyScratch(position.area);
  const { xs, ys, colors, packed } = scratch;
  const stoneCount = collectStoneData(position, xs, ys, colors);
  return computeCanonicalPackedKey(xs, ys, colors, stoneCount, {
    includeTranslationSymmetry: options.includeTranslationSymmetry,
    includeColorSymmetry: options.includeColorSymmetry,
  }, packed);
}

function createSeededRandom(seed: number | undefined): () => number {
  let state = (seed ?? Date.now()) | 0;
  if (state === 0) {
    state = DEFAULT_SEED_STATE;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function encodeRepresentativeHistory(
  position: GogoPosition,
  includeTranslationSymmetry: boolean,
  nextRandom: () => number,
): string {
  const transform = DIHEDRAL_TRANSFORMS[nextRandom() % DIHEDRAL_TRANSFORMS.length];
  const transformedMoves: Array<readonly [number, number]> = new Array(position.ply);
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  for (let ply = 0; ply < position.ply; ply += 1) {
    const move = position.getMoveAt(ply);
    const [x, y] = transform(position.meta.xs[move], position.meta.ys[move]);
    transformedMoves[ply] = [x, y];
    if (ply === 0 || x < minX) {
      minX = x;
    }
    if (ply === 0 || y < minY) {
      minY = y;
    }
    if (ply === 0 || x > maxX) {
      maxX = x;
    }
    if (ply === 0 || y > maxY) {
      maxY = y;
    }
  }

  let shiftX = 0;
  let shiftY = 0;
  if (includeTranslationSymmetry && transformedMoves.length > 0) {
    shiftX = Math.floor((position.size - (maxX - minX + 1)) / 2) - minX;
    shiftY = Math.floor((position.size - (maxY - minY + 1)) / 2) - minY;
  }

  const encodedMoves: string[] = new Array(position.ply);
  for (let ply = 0; ply < transformedMoves.length; ply += 1) {
    const x = transformedMoves[ply][0] + shiftX;
    const y = transformedMoves[ply][1] + shiftY;
    encodedMoves[ply] = encodeMove(position.index(x, y), position.meta);
  }
  return `B${position.size}${encodedMoves.length > 0 ? ` ${encodedMoves.join(' ')}` : ''}`;
}

export function computePositionSymmetryKey(
  position: GogoPosition,
  options: PositionSymmetryOptions,
): string {
  return computePositionSymmetryKeyFast(position, options);
}

export function streamUniqueBoards(
  options: StreamUniqueBoardsOptions,
  emit: (encodedBoard: string) => void,
): StreamUniqueBoardsStats {
  if (!Number.isInteger(options.ply) || options.ply < 0) {
    throw new Error(`Invalid ply: ${options.ply}`);
  }

  const boardSize = parseSupportedSize(options.boardSize ?? 9);
  const maxBoards = options.maxBoards ?? Number.POSITIVE_INFINITY;
  if (maxBoards < 0 || Number.isNaN(maxBoards)) {
    throw new Error(`Invalid maxBoards: ${maxBoards}`);
  }

  const position = new GogoPosition(boardSize, {
    historyCapacity: Math.max(1, options.ply),
  });
  const moveBuffer = new Int16Array(position.area);
  const prefixSeen = Array.from({ length: options.ply }, () => new Set<string>());
  const finalSeen = new Set<string>();
  const nextRandom = createSeededRandom(options.seed);
  const now = options.now ?? (() => Date.now());
  const deadline = options.timeLimitMs === undefined
    ? Number.POSITIVE_INFINITY
    : now() + Math.max(0, options.timeLimitMs);
  const stats: StreamUniqueBoardsStats = {
    emitted: 0,
    exploredNodes: 0,
    prunedPrefixes: 0,
    truncatedByAmount: maxBoards === 0,
    truncatedByTime: false,
  };

  const shouldStop = (): boolean => stats.truncatedByAmount || stats.truncatedByTime;
  const checkTime = (): boolean => {
    if (now() > deadline) {
      stats.truncatedByTime = true;
      return true;
    }
    return false;
  };

  const visit = (depth: number): void => {
    if (shouldStop() || checkTime()) {
      return;
    }

    if (depth === options.ply) {
      const finalKey = computePositionSymmetryKey(position, {
        includeTranslationSymmetry: options.includeTranslationSymmetry,
        includeColorSymmetry: options.includeColorSymmetry,
      });
      if (finalSeen.has(finalKey)) {
        return;
      }
      finalSeen.add(finalKey);
      emit(encodeRepresentativeHistory(position, options.includeTranslationSymmetry, nextRandom));
      stats.emitted += 1;
      if (stats.emitted >= maxBoards) {
        stats.truncatedByAmount = true;
      }
      return;
    }

    const moveCount = position.generateAllLegalMoves(moveBuffer);
    for (let i = 0; i < moveCount; i += 1) {
      if (shouldStop() || checkTime()) {
        return;
      }

      const move = moveBuffer[i];
      position.play(move);
      stats.exploredNodes += 1;

      if (depth + 1 < options.ply) {
        const prefixKey = computePositionSymmetryKey(position, {
          includeTranslationSymmetry: false,
          includeColorSymmetry: false,
        });
        const seenAtDepth = prefixSeen[depth];
        if (seenAtDepth.has(prefixKey)) {
          stats.prunedPrefixes += 1;
          position.undo();
          continue;
        }
        seenAtDepth.add(prefixKey);
      }

      visit(depth + 1);
      position.undo();
    }
  };

  visit(0);
  return stats;
}
