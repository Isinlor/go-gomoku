import { BLACK, WHITE, EMPTY, GogoPosition, encodeMove } from './gogomoku';
import type { Player, SupportedSize } from './gogomoku';

type Stone = readonly [number, number, Player];
type AbsoluteTransform = (x: number, y: number, size: number) => readonly [number, number];

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

function normalizeStones(stones: Stone[], includeTranslationSymmetry: boolean): Stone[] {
  if (!includeTranslationSymmetry || stones.length === 0) {
    return stones;
  }

  let minX = stones[0][0];
  let minY = stones[0][1];
  for (let i = 1; i < stones.length; i += 1) {
    if (stones[i][0] < minX) {
      minX = stones[i][0];
    }
    if (stones[i][1] < minY) {
      minY = stones[i][1];
    }
  }

  for (let i = 0; i < stones.length; i += 1) {
    stones[i] = [stones[i][0] - minX, stones[i][1] - minY, stones[i][2]];
  }
  return stones;
}

function encodeStones(stones: readonly Stone[]): string {
  let encoded = '';
  for (let i = 0; i < stones.length; i += 1) {
    if (i > 0) {
      encoded += ';';
    }
    encoded += `${stones[i][0]},${stones[i][1]},${stones[i][2]}`;
  }
  return encoded;
}

function compareStones(a: Stone, b: Stone): number {
  const deltaX = a[0] - b[0];
  if (deltaX !== 0) {
    return deltaX;
  }
  return a[1] - b[1];
}

function collectStones(position: GogoPosition): Stone[] {
  const stones: Stone[] = [];
  for (let index = 0; index < position.area; index += 1) {
    const cell = position.board[index];
    if (cell !== EMPTY) {
      stones.push([position.meta.xs[index], position.meta.ys[index], cell as Player]);
    }
  }
  return stones;
}

function transformStones(
  stones: readonly Stone[],
  size: number,
  transform: AbsoluteTransform,
  includeTranslationSymmetry: boolean,
  swapColors: boolean,
): Stone[] {
  const transformed: Stone[] = new Array(stones.length);
  for (let i = 0; i < stones.length; i += 1) {
    const [x, y] = transform(stones[i][0], stones[i][1], size);
    const color = swapColors
      ? (stones[i][2] === BLACK ? WHITE : BLACK)
      : stones[i][2];
    transformed[i] = [x, y, color];
  }

  normalizeStones(transformed, includeTranslationSymmetry);
  transformed.sort(compareStones);
  return transformed;
}

function computeStonesSymmetryKey(
  stones: readonly Stone[],
  size: number,
  options: PositionSymmetryOptions,
): string {
  if (stones.length === 0) {
    return '';
  }

  let best = '';
  for (let transformIndex = 0; transformIndex < ABSOLUTE_TRANSFORMS.length; transformIndex += 1) {
    const transformed = transformStones(
      stones,
      size,
      ABSOLUTE_TRANSFORMS[transformIndex],
      options.includeTranslationSymmetry,
      false,
    );
    const encoded = encodeStones(transformed);
    if (best === '' || encoded < best) {
      best = encoded;
    }

    if (options.includeColorSymmetry) {
      const swapped = transformStones(
        stones,
        size,
        ABSOLUTE_TRANSFORMS[transformIndex],
        options.includeTranslationSymmetry,
        true,
      );
      const swappedEncoded = encodeStones(swapped);
      if (swappedEncoded < best) {
        best = swappedEncoded;
      }
    }
  }

  return best;
}

function createSeededRandom(seed: number | undefined): () => number {
  let state = (seed ?? Date.now()) | 0;
  if (state === 0) {
    state = 0x6D2B79F5;
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
  return computeStonesSymmetryKey(collectStones(position), position.size, options);
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
