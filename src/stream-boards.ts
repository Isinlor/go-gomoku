import { streamUniqueBoards } from './engine/boardStream';
import type {
  StreamUniqueBoardsOptions,
  StreamUniqueBoardsStats,
} from './engine/boardStream';
import { parseIntegerFlag } from './cliArgs';
import type { SupportedSize } from './engine/gogomoku';

declare const process: { argv: string[]; exit(code: number): never };

export interface StreamBoardsMainOptions {
  writeStdout?: (line: string) => void;
  writeStderr?: (line: string) => void;
}

function parseSize(size: number): SupportedSize {
  if (size !== 9 && size !== 11 && size !== 13) {
    throw new Error(`Unsupported board size: ${size}`);
  }
  return size;
}

export function parseArgs(args: string[]): StreamUniqueBoardsOptions {
  let ply: number | undefined;
  let boardSize: SupportedSize = 9;
  let maxBoards: number | undefined;
  let timeLimitMs: number | undefined;
  let includeTranslationSymmetry = false;
  let includeColorSymmetry = false;
  let seed: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--ply':
        ply = parseIntegerFlag(args, i, '--ply');
        i += 1;
        break;
      case '--size':
        boardSize = parseSize(parseIntegerFlag(args, i, '--size'));
        i += 1;
        break;
      case '--limit':
        maxBoards = parseIntegerFlag(args, i, '--limit');
        i += 1;
        break;
      case '--time-ms':
        timeLimitMs = parseIntegerFlag(args, i, '--time-ms');
        i += 1;
        break;
      case '--translation-symmetry':
        includeTranslationSymmetry = true;
        break;
      case '--color-symmetry':
        includeColorSymmetry = true;
        break;
      case '--seed':
        seed = parseIntegerFlag(args, i, '--seed');
        i += 1;
        break;
      default:
        break;
    }
  }

  if (ply === undefined) {
    throw new Error('Missing required --ply value');
  }

  return {
    ply,
    boardSize,
    maxBoards,
    timeLimitMs,
    includeTranslationSymmetry,
    includeColorSymmetry,
    seed,
  };
}

export function formatStreamBoardsSummary(stats: StreamUniqueBoardsStats): string {
  const truncation: string[] = [];
  if (stats.truncatedByTime) {
    truncation.push('time');
  }
  if (stats.truncatedByAmount) {
    truncation.push('amount');
  }

  return [
    `emitted=${stats.emitted}`,
    `explored=${stats.exploredNodes}`,
    `pruned=${stats.prunedPrefixes}`,
    `truncated=${truncation.length === 0 ? 'none' : truncation.join(',')}`,
  ].join(' ');
}

export function main(args: string[], options: StreamBoardsMainOptions = {}): void {
  const writeStdout = options.writeStdout ?? ((line: string) => console.log(line));
  const writeStderr = options.writeStderr ?? ((line: string) => console.error(line));

  try {
    const parsed = parseArgs(args);
    const stats = streamUniqueBoards(parsed, (board) => {
      writeStdout(board);
    });
    writeStderr(formatStreamBoardsSummary(stats));
  } catch (error) {
    writeStderr(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/* v8 ignore next 3 */
if (process.argv[1] && process.argv[1].endsWith('stream-boards.js')) {
  main(process.argv.slice(2));
}
