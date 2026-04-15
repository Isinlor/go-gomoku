import { BLACK, WHITE, EMPTY, GogoPosition, encodeMove } from './gogomoku';
import type { Player, SupportedSize } from './gogomoku';

type Stone = readonly [number, number, Player];
type AbsoluteTransform = (x: number, y: number, size: number) => readonly [number, number];
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

const ABSOLUTE_TRANSFORMS: readonly AbsoluteTransform[] = [
  (x, y) => [x, y],
  (x, y, size) => [size - 1 - y, x],
  (x, y, size) => [size - 1 - x, size - 1 - y],
  (x, y, size) => [y, size - 1 - x],
  (x, y, size) => [size - 1 - x, y],
  (x, y, size) => [x, size - 1 - y],
  (x, y) => [y, x],
  (x, y, size) => [size - 1 - y, size - 1 - x],
];
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

function transformX(transformIndex: number, x: number, y: number, size: number): number {
  switch (transformIndex) {
    case 0:
      return x;
    case 1:
      return size - 1 - y;
    case 2:
    case 4:
      return size - 1 - x;
    case 5:
      return x;
    case 3:
    case 6:
      return y;
    default:
      return size - 1 - y;
  }
}

function transformY(transformIndex: number, x: number, y: number, size: number): number {
  switch (transformIndex) {
    case 0:
    case 4:
      return y;
    case 1:
    case 6:
      return x;
    case 2:
    case 5:
      return size - 1 - y;
    default:
      return size - 1 - x;
  }
}

function sortPackedKeys(packed: Uint16Array, count: number): void {
  if (count < 2) {
    return;
  }

  if (count < 16) {
    for (let i = 1; i < count; i += 1) {
      const value = packed[i];
      let j = i - 1;
      while (j >= 0 && packed[j] > value) {
        packed[j + 1] = packed[j];
        j -= 1;
      }
      packed[j + 1] = value;
    }
    return;
  }

  packed.subarray(0, count).sort();
}

function encodePackedKeys(packed: Uint16Array, count: number): string {
  let key = '';
  for (let i = 0; i < count; i += 1) {
    key += String.fromCharCode(packed[i]);
  }
  return key;
}

function computePositionSymmetryKeyFast(
  position: GogoPosition,
  options: PositionSymmetryOptions,
): string {
  const scratch = getSymmetryKeyScratch(position.area);
  const { xs, ys, colors, packed } = scratch;
  const stoneCount = collectStoneData(position, xs, ys, colors);
  if (stoneCount === 0) {
    return '';
  }

  let best = '';
  const colorVariants = options.includeColorSymmetry ? 2 : 1;
  for (let transformIndex = 0; transformIndex < ABSOLUTE_TRANSFORMS.length; transformIndex += 1) {
    let minX = 0;
    let minY = 0;
    if (options.includeTranslationSymmetry) {
      for (let i = 0; i < stoneCount; i += 1) {
        const x = transformX(transformIndex, xs[i], ys[i], position.size);
        const y = transformY(transformIndex, xs[i], ys[i], position.size);
        if (i === 0 || x < minX) {
          minX = x;
        }
        if (i === 0 || y < minY) {
          minY = y;
        }
      }
    }

    for (let variant = 0; variant < colorVariants; variant += 1) {
      for (let i = 0; i < stoneCount; i += 1) {
        const x = transformX(transformIndex, xs[i], ys[i], position.size) - minX;
        const y = transformY(transformIndex, xs[i], ys[i], position.size) - minY;
        const color = variant === 0
          ? colors[i]
          : (colors[i] === BLACK ? WHITE : BLACK);
        packed[i] = (((x << 4) | y) << 2) | color;
      }
      sortPackedKeys(packed, stoneCount);
      const candidate = encodePackedKeys(packed, stoneCount);
      if (best === '' || candidate < best) {
        best = candidate;
      }
    }
  }

  return best;
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
  const transform = ABSOLUTE_TRANSFORMS[nextRandom() % ABSOLUTE_TRANSFORMS.length];
  const transformedMoves: Array<readonly [number, number]> = new Array(position.ply);
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  for (let ply = 0; ply < position.ply; ply += 1) {
    const move = position.getMoveAt(ply);
    const [x, y] = transform(position.meta.xs[move], position.meta.ys[move], position.size);
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

function validateSize(size: number): SupportedSize {
  if (size !== 9 && size !== 11 && size !== 13) {
    throw new Error(`Unsupported board size: ${size}`);
  }
  return size;
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

  const boardSize = validateSize(options.boardSize ?? 9);
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
