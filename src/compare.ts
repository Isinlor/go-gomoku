import { GogoAI, GogoPosition, type SupportedSize } from './index.js';

declare const process: { argv: string[]; exit(code: number): never };

export interface AIPlayer {
  findBestMove(position: GogoPosition, timeLimitMs: number): { move: number };
}

export interface CompareOptions {
  timeLimitMs: number;
  numGames: number;
  boardSize: SupportedSize;
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
      return {
        winner: opponent,
        moves,
        ai1Color,
        invalidMove: { ai: currentAINum, move: result.move, reason: 'timeout' },
      };
    }

    if (result.move === -1) {
      return {
        winner: opponent,
        moves,
        ai1Color,
        invalidMove: { ai: currentAINum, move: -1, reason: 'refused' },
      };
    }

    if (!position.isLegal(result.move)) {
      return {
        winner: opponent,
        moves,
        ai1Color,
        invalidMove: { ai: currentAINum, move: result.move, reason: 'illegal' },
      };
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
): CompareResult {
  const factory = createAI ?? (() => new GogoAI());
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

  for (let i = 0; i < options.numGames; i++) {
    const ai1 = factory();
    const ai2 = factory();
    const ai1Color: 1 | 2 = i % 2 === 0 ? 1 : 2;
    const position = positionFactory(options.boardSize);
    const gameResult = playGame(ai1, ai2, options.timeLimitMs, ai1Color, position, now);
    result.results.push(gameResult);
    result.totalGames++;
    if (gameResult.invalidMove) result.invalidMoves++;
    if (gameResult.winner === 1) result.ai1Wins++;
    else if (gameResult.winner === 2) result.ai2Wins++;
    else result.draws++;
  }

  return result;
}

export function parseArgs(args: string[]): CompareOptions {
  let timeLimitMs = 100;
  let numGames = 10;
  let boardSize: SupportedSize = 9;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--time') timeLimitMs = parseInt(args[++i], 10);
    else if (args[i] === '--games') numGames = parseInt(args[++i], 10);
    else if (args[i] === '--size') boardSize = parseInt(args[++i], 10) as SupportedSize;
  }

  return { timeLimitMs, numGames, boardSize };
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

export function main(args: string[], createAI?: () => AIPlayer): void {
  const options = parseArgs(args);
  console.log(
    `Comparing AIs: ${options.numGames} games, ${options.timeLimitMs}ms per move, ` +
    `${options.boardSize}x${options.boardSize} board`,
  );
  const result = compareAIs(options, createAI);
  console.log(formatResults(result));
  if (result.invalidMoves > 0) {
    console.error('Error: Invalid moves detected!');
    process.exit(1);
  }
}

/* node:coverage ignore next 3 */
if (process.argv[1] && process.argv[1].endsWith('compare.js')) {
  main(process.argv.slice(2));
}
