import { GogoAI, GogoPosition, type SupportedSize } from './index.js';

declare const process: { argv: string[]; exit(code: number): never };

export interface AIPlayer {
  findBestMove(position: GogoPosition, timeLimitMs: number): { move: number };
}

export interface AIConfig {
  maxDepth?: number;
  quiescenceDepth?: number;
}

export interface CompareOptions {
  ai1Config: AIConfig;
  ai2Config: AIConfig;
  timeLimitMs: number;
  numGames: number;
  boardSize: SupportedSize;
}

export interface InvalidMoveInfo {
  ai: 1 | 2;
  move: number;
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

export function parseAIConfig(spec: string): AIConfig {
  const config: AIConfig = {};
  if (!spec || spec === 'default') return config;
  for (const part of spec.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim();
    const val = parseInt(part.slice(colonIdx + 1).trim(), 10);
    if (key === 'maxDepth' || key === 'depth') {
      config.maxDepth = val;
    } else if (key === 'quiescenceDepth' || key === 'quiescence') {
      config.quiescenceDepth = val;
    }
  }
  return config;
}

export function playGame(
  ai1: AIPlayer,
  ai2: AIPlayer,
  timeLimitMs: number,
  ai1Color: 1 | 2,
  boardSize: SupportedSize,
): GameResult {
  const position = new GogoPosition(boardSize);
  let moves = 0;

  while (position.winner === 0) {
    const currentAINum: 1 | 2 = position.toMove === ai1Color ? 1 : 2;
    const currentAI = currentAINum === 1 ? ai1 : ai2;
    const result = currentAI.findBestMove(position, timeLimitMs);

    if (result.move === -1) break;

    if (!position.isLegal(result.move)) {
      return {
        winner: currentAINum === 1 ? 2 : 1,
        moves,
        ai1Color,
        invalidMove: { ai: currentAINum, move: result.move },
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
  createAI?: (config: AIConfig) => AIPlayer,
): CompareResult {
  const factory = createAI ?? ((config: AIConfig) => new GogoAI(config));
  const result: CompareResult = {
    ai1Wins: 0,
    ai2Wins: 0,
    draws: 0,
    totalGames: 0,
    invalidMoves: 0,
    results: [],
  };

  for (let i = 0; i < options.numGames; i++) {
    const ai1 = factory(options.ai1Config);
    const ai2 = factory(options.ai2Config);
    const ai1Color: 1 | 2 = i % 2 === 0 ? 1 : 2;
    const gameResult = playGame(ai1, ai2, options.timeLimitMs, ai1Color, options.boardSize);
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
  let ai1Spec = 'default';
  let ai2Spec = 'default';
  let timeLimitMs = 100;
  let numGames = 10;
  let boardSize: SupportedSize = 9;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ai1') ai1Spec = args[++i];
    else if (args[i] === '--ai2') ai2Spec = args[++i];
    else if (args[i] === '--time') timeLimitMs = parseInt(args[++i], 10);
    else if (args[i] === '--games') numGames = parseInt(args[++i], 10);
    else if (args[i] === '--size') boardSize = parseInt(args[++i], 10) as SupportedSize;
  }

  return {
    ai1Config: parseAIConfig(ai1Spec),
    ai2Config: parseAIConfig(ai2Spec),
    timeLimitMs,
    numGames,
    boardSize,
  };
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

export function main(args: string[], createAI?: (config: AIConfig) => AIPlayer): void {
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
