import { GogoAI, GogoPosition } from './engine/index.js';
import { readFlagValue } from './cliArgs';
import type { SupportedSize } from './engine/index.js';

declare const process: { argv: string[]; exit(code: number): never };

export interface AIPlayer {
  findBestMove(position: GogoPosition, timeLimitMs: number): { move: number };
}

export interface CompareOptions {
  timeLimitMs: number;
  numPairs: number;
  boardSize: SupportedSize;
  ai1?: 'classic';
  ai2?: 'classic';
  seed?: number;
  now?: () => number;
}

export interface InvalidMoveInfo {
  ai: 1 | 2;
  move: number;
  reason: 'illegal' | 'refused' | 'timeout';
}

export interface GameResult {
  winner: 0 | 1 | 2;
  moves: number;
  ai1Color: 1 | 2;
  invalidMove?: InvalidMoveInfo;
}

export interface CompareResult {
  ai1Wins: number;
  ai2Wins: number;
  draws: number;
  totalGames: number;
  invalidMoves: number;
  results: GameResult[];
}

const FLAG_UPDATERS = {
  '--time': (value: string, update: (value: number) => void) => update(Number.parseInt(value, 10)),
  '--pairs': (value: string, update: (value: number) => void) => update(Number.parseInt(value, 10)),
  '--size': (value: string, update: (value: SupportedSize) => void) =>
    update(Number.parseInt(value, 10) as SupportedSize),
  '--seed': (value: string, update: (value: number) => void) => update(Number.parseInt(value, 10)),
  '--ai1': (_value: string, update: (value: 'classic') => void) => update('classic'),
  '--ai2': (_value: string, update: (value: 'classic') => void) => update('classic'),
} as const;

function invalidGameResult(
  winner: 1 | 2,
  moves: number,
  ai1Color: 1 | 2,
  ai: 1 | 2,
  move: number,
  reason: InvalidMoveInfo['reason'],
): GameResult {
  return {
    winner,
    moves,
    ai1Color,
    invalidMove: { ai, move, reason },
  };
}

export function playGame(
  ai1: AIPlayer,
  ai2: AIPlayer,
  timeLimitMs: number,
  ai1Color: 1 | 2,
  position: GogoPosition,
  now: () => number = () => Date.now(),
): GameResult {
  let moves = 0;

  while (position.winner === 0) {
    if (!position.hasAnyLegalMove()) break;

    const currentAINum: 1 | 2 = position.toMove === ai1Color ? 1 : 2;
    const currentAI = currentAINum === 1 ? ai1 : ai2;
    const opponent: 1 | 2 = currentAINum === 1 ? 2 : 1;

    const start = now();
    const result = currentAI.findBestMove(position, timeLimitMs);
    const elapsed = now() - start;

    if (elapsed > timeLimitMs) {
      return invalidGameResult(opponent, moves, ai1Color, currentAINum, result.move, 'timeout');
    }

    if (result.move === -1) {
      return invalidGameResult(opponent, moves, ai1Color, currentAINum, -1, 'refused');
    }

    if (!position.isLegal(result.move)) {
      return invalidGameResult(opponent, moves, ai1Color, currentAINum, result.move, 'illegal');
    }

    position.play(result.move);
    moves++;
  }

  return {
    winner: position.winner === 0 ? 0 : (position.winner === ai1Color ? 1 : 2),
    moves,
    ai1Color,
  };
}

export function compareAIs(
  options: CompareOptions,
  createAI?: () => AIPlayer,
  createPosition?: (size: SupportedSize) => GogoPosition,
  createAI2?: () => AIPlayer,
): CompareResult {
  const factory = createAI ?? (() => new GogoAI());
  const factory2 = createAI2 ?? factory;
  const positionFactory = createPosition ?? ((size: SupportedSize) => new GogoPosition(size));
  const now = options.now ?? (() => Date.now());
  const result: CompareResult = {
    ai1Wins: 0,
    ai2Wins: 0,
    draws: 0,
    totalGames: 0,
    invalidMoves: 0,
    results: [],
  };

  for (let i = 0; i < options.numPairs; i++) {
    for (const ai1Color of [1, 2] as const) {
      const ai1 = factory();
      const ai2 = factory2();
      const position = positionFactory(options.boardSize);
      const gameResult = playGame(ai1, ai2, options.timeLimitMs, ai1Color, position, now);
      result.results.push(gameResult);
      result.totalGames++;
      if (gameResult.invalidMove) result.invalidMoves++;
      if (gameResult.winner === 1) result.ai1Wins++;
      else if (gameResult.winner === 2) result.ai2Wins++;
      else result.draws++;
    }
  }

  return result;
}

export function parseArgs(args: string[]): CompareOptions {
  let timeLimitMs = 100;
  let numPairs = 5;
  let boardSize: SupportedSize = 9;
  let ai1: 'classic' = 'classic';
  let ai2: 'classic' = 'classic';
  let seed = 1;
  const setters = {
    '--time': (value: string) => FLAG_UPDATERS['--time'](value, (next) => { timeLimitMs = next; }),
    '--pairs': (value: string) => FLAG_UPDATERS['--pairs'](value, (next) => { numPairs = next; }),
    '--size': (value: string) => FLAG_UPDATERS['--size'](value, (next) => { boardSize = next; }),
    '--ai1': (value: string) => FLAG_UPDATERS['--ai1'](value, (next) => { ai1 = next; }),
    '--ai2': (value: string) => FLAG_UPDATERS['--ai2'](value, (next) => { ai2 = next; }),
    '--seed': (value: string) => FLAG_UPDATERS['--seed'](value, (next) => { seed = next; }),
  } as const;

  for (let i = 0; i < args.length; i++) {
    const value = readFlagValue(args, i);
    const update = setters[args[i] as keyof typeof setters];
    if (value !== undefined && update !== undefined) {
      update(value);
      i += 1;
    }
  }

  return { timeLimitMs, numPairs, boardSize, ai1, ai2, seed };
}

export function formatResults(result: CompareResult): string {
  const pct = (n: number) =>
    result.totalGames === 0 ? '0.0' : ((n / result.totalGames) * 100).toFixed(1);
  const lines = [
    `Results after ${result.totalGames} games:`,
    `  AI1 wins: ${result.ai1Wins} (${pct(result.ai1Wins)}%)`,
    `  AI2 wins: ${result.ai2Wins} (${pct(result.ai2Wins)}%)`,
    `  Draws: ${result.draws}`,
  ];
  if (result.invalidMoves > 0) {
    lines.push(`  Invalid moves detected: ${result.invalidMoves}`);
  }
  return lines.join('\n');
}

export function main(args: string[], createAI?: () => AIPlayer, createAI2?: () => AIPlayer): void {
  const options = parseArgs(args);
  /* v8 ignore start */
  const ai1Kind = options.ai1 ?? 'classic';
  const ai2Kind = options.ai2 ?? 'classic';
  const seed = options.seed ?? 1;
  /* v8 ignore stop */
  const buildFactory = (_kind: 'classic', _seedOffset: number) => () => new GogoAI();
  const ai1Factory = createAI ?? buildFactory(ai1Kind, 17);
  const ai2Factory = createAI2 ?? createAI ?? buildFactory(ai2Kind, 101);
  console.log(
    `Comparing AIs: ${options.numPairs} pairs (${options.numPairs * 2} games), ${options.timeLimitMs}ms per move, ` +
    `${options.boardSize}x${options.boardSize} board, AI1=${ai1Kind}, AI2=${ai2Kind}`,
  );
  const result = compareAIs(options, ai1Factory, undefined, ai2Factory);
  console.log(formatResults(result));
  if (result.invalidMoves > 0) {
    console.error('Error: Invalid moves detected!');
    process.exit(1);
  }
}

/* v8 ignore next 3 */
if (process.argv[1] && process.argv[1].endsWith('compare.js')) {
  main(process.argv.slice(2));
}
