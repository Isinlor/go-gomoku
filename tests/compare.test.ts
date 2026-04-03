import { test, describe, expect, vi } from 'vitest';

import { GogoPosition } from '../src/engine';
import {
  playGame,
  compareAIs,
  parseArgs,
  formatResults,
  main,
} from '../src/compare';
import type { AIPlayer } from '../src/compare';

// Helper: create a mock AI that plays a fixed sequence of moves
function seqAI(moves: number[]): AIPlayer {
  let i = 0;
  return { findBestMove: () => ({ move: moves[i++] ?? -1 }) };
}

// On a 9x9 board (size=9), index = y*9 + x.
// A horizontal win for BLACK: indices 0,1,2,3,4 (row 0, columns 0-4).
// Interleaved with WHITE at 9,18,27,36 (column 0, rows 1-4 – never reaches 5 in a row).
const BLACK_WIN = [0, 1, 2, 3, 4];
const WHITE_IDLE = [9, 18, 27, 36];

// A completely filled 9×9 board with no 5-in-a-row in any direction.
// Pattern: color(r,c) = ((c + 2r) mod 5 < 4) ? X : O
// This guarantees exactly one O per every 5-window in all four directions,
// so no five consecutive same-color stones can ever occur.
const FULL_BOARD_NO_WINNER = GogoPosition.fromAscii([
  'XXXXOXXXX',
  'XXOXXXXOX',
  'OXXXXOXXX',
  'XXXOXXXXO',
  'XOXXXXOXX',
  'XXXXOXXXX',
  'XXOXXXXOX',
  'OXXXXOXXX',
  'XXXOXXXXO',
]);

test('playGame - AI1 wins when playing BLACK and completing a five-in-a-row', () => {
  // AI1 (BLACK) plays cells 0-4 to form a horizontal five-in-a-row.
  const result = playGame(seqAI(BLACK_WIN), seqAI(WHITE_IDLE), 100, 1, new GogoPosition(9));
  expect(result.winner).toBe(1);
  expect(result.ai1Color).toBe(1);
  expect(result.moves).toBe(9);
  expect(result.invalidMove).toBeUndefined();
});

test('playGame - AI2 wins when playing BLACK (ai1Color=WHITE)', () => {
  // AI1 is WHITE; BLACK (= AI2) goes first and wins.
  const result = playGame(seqAI(WHITE_IDLE), seqAI(BLACK_WIN), 100, 2, new GogoPosition(9));
  expect(result.winner).toBe(2);
  expect(result.ai1Color).toBe(2);
  expect(result.invalidMove).toBeUndefined();
});

test('playGame - draw when no legal moves remain before any AI is called', () => {
  // Full board with no winner: hasAnyLegalMove() is false on the very first loop
  // iteration, so the loop breaks immediately and the game is a draw.
  const result = playGame(seqAI([]), seqAI([]), 100, 1, FULL_BOARD_NO_WINNER);
  expect(result.winner).toBe(0);
  expect(result.moves).toBe(0);
  expect(result.invalidMove).toBeUndefined();
});

test('playGame - AI1 invalid move: returns -1 when legal moves exist (refused)', () => {
  // On an empty board legal moves exist, so returning -1 is a protocol violation.
  const result = playGame(seqAI([-1]), seqAI(WHITE_IDLE), 100, 1, new GogoPosition(9));
  expect(result.winner).toBe(2);
  expect(result.moves).toBe(0);
  expect(result.invalidMove).toBeDefined();
  expect(result.invalidMove!.ai).toBe(1);
  expect(result.invalidMove!.move).toBe(-1);
  expect(result.invalidMove!.reason).toBe('refused');
});

test('playGame - AI2 invalid move: returns -1 when legal moves exist (refused)', () => {
  // AI1 plays one valid move, then AI2 refuses to play on an otherwise legal board.
  const result = playGame(seqAI([0]), seqAI([-1]), 100, 1, new GogoPosition(9));
  expect(result.winner).toBe(1);
  expect(result.moves).toBe(1);
  expect(result.invalidMove).toBeDefined();
  expect(result.invalidMove!.ai).toBe(2);
  expect(result.invalidMove!.reason).toBe('refused');
});

test('playGame - AI1 invalid move: returns an illegal move index', () => {
  // Out-of-bounds index is never legal.
  const result = playGame(seqAI([9999]), seqAI(WHITE_IDLE), 100, 1, new GogoPosition(9));
  expect(result.winner).toBe(2);
  expect(result.moves).toBe(0);
  expect(result.invalidMove).toBeDefined();
  expect(result.invalidMove!.ai).toBe(1);
  expect(result.invalidMove!.move).toBe(9999);
  expect(result.invalidMove!.reason).toBe('illegal');
});

test('playGame - AI2 invalid move: plays an occupied cell', () => {
  // AI1 plays cell 0 (valid), then AI2 attempts to play the same cell.
  const result = playGame(seqAI([0]), seqAI([0]), 100, 1, new GogoPosition(9));
  expect(result.winner).toBe(1);
  expect(result.moves).toBe(1);
  expect(result.invalidMove).toBeDefined();
  expect(result.invalidMove!.ai).toBe(2);
  expect(result.invalidMove!.move).toBe(0);
  expect(result.invalidMove!.reason).toBe('illegal');
});

test('playGame - AI1 timeout: wall clock exceeds limit before result is used', () => {
  // Mock clock: start=0, then jumps to 1000 after findBestMove returns.
  // elapsed = 1000 - 0 = 1000 > timeLimitMs=100 → timeout for AI1.
  let call = 0;
  const clock = () => (call++ === 0 ? 0 : 1000);
  const result = playGame(seqAI([0]), seqAI([0]), 100, 1, new GogoPosition(9), clock);
  expect(result.winner).toBe(2);
  expect(result.moves).toBe(0);
  expect(result.invalidMove).toBeDefined();
  expect(result.invalidMove!.ai).toBe(1);
  expect(result.invalidMove!.reason).toBe('timeout');
});

test('playGame - AI2 timeout: time limit triggered on AI2 turn', () => {
  // AI1 plays one valid move (clock at 0→0, no timeout), then AI2 exceeds the limit.
  let call = 0;
  // Calls: start_ai1=0, end_ai1=0 (ok), start_ai2=0, end_ai2=1000 (timeout)
  const clock = () => ([0, 0, 0, 1000][call++] ?? 0);
  const result = playGame(seqAI([0]), seqAI([40]), 100, 1, new GogoPosition(9), clock);
  expect(result.winner).toBe(1);
  expect(result.invalidMove).toBeDefined();
  expect(result.invalidMove!.ai).toBe(2);
  expect(result.invalidMove!.reason).toBe('timeout');
});

test('compareAIs - AI1 wins and AI2 wins outcomes with mock factory', () => {
  // Pair 0, game A (ai1Color=1): AI1 is BLACK → plays BLACK_WIN → AI1 wins
  // Pair 0, game B (ai1Color=2): AI1 is WHITE, AI2 is BLACK → AI2 plays BLACK_WIN → AI2 wins
  let callIdx = 0;
  const ais = [seqAI(BLACK_WIN), seqAI(WHITE_IDLE), seqAI(WHITE_IDLE), seqAI(BLACK_WIN)];
  const result = compareAIs(
    { timeLimitMs: 100, numPairs: 1, boardSize: 9 },
    () => ais[callIdx++],
  );
  expect(result.ai1Wins).toBe(1);
  expect(result.ai2Wins).toBe(1);
  expect(result.draws).toBe(0);
  expect(result.totalGames).toBe(2);
  expect(result.invalidMoves).toBe(0);
  // Verify both colors played within the pair
  expect(result.results[0].ai1Color).toBe(1);
  expect(result.results[1].ai1Color).toBe(2);
});

test('compareAIs - draw outcome via full board with no winner', () => {
  // Inject the pre-filled board so hasAnyLegalMove() returns false immediately.
  // numPairs:1 → 2 games, both draws.
  const result = compareAIs(
    { timeLimitMs: 100, numPairs: 1, boardSize: 9 },
    () => seqAI([]),
    () => FULL_BOARD_NO_WINNER,
  );
  expect(result.draws).toBe(2);
  expect(result.ai1Wins).toBe(0);
  expect(result.ai2Wins).toBe(0);
  expect(result.totalGames).toBe(2);
  expect(result.invalidMoves).toBe(0);
});

test('compareAIs - counts invalid moves and records them in results', () => {
  // Pair 0, game A (ai1Color=1): AI1 is BLACK, returns illegal move immediately.
  // Pair 0, game B (ai1Color=2): clean game: AI1 WHITE, AI2 BLACK wins legitimately.
  let callIdx = 0;
  const ais = [seqAI([9999]), seqAI(WHITE_IDLE), seqAI(WHITE_IDLE), seqAI(BLACK_WIN)];
  const result = compareAIs(
    { timeLimitMs: 100, numPairs: 1, boardSize: 9 },
    () => ais[callIdx++],
  );
  expect(result.invalidMoves).toBe(1);
  expect(result.totalGames).toBe(2);
  expect(result.results[0].invalidMove).toBeDefined();
  expect(result.results[0].invalidMove!.reason).toBe('illegal');
  expect(result.results[1].invalidMove).toBeUndefined();
});

test('compareAIs - uses default GogoAI factory when none provided', () => {
  const result = compareAIs({ timeLimitMs: 10, numPairs: 1, boardSize: 9 });
  expect(result.totalGames).toBe(2);
  expect(result.ai1Wins + result.ai2Wins + result.draws).toBe(2);
});

test('compareAIs - passes options.now clock to playGame for timeout enforcement', () => {
  // Make every AI call appear to violate the time limit.
  // numPairs:1 → 2 games, each game's first AI call times out → 2 invalid moves.
  let call = 0;
  const clock = () => (call++ % 2 === 0 ? 0 : 1000);
  let callIdx = 0;
  const ais = [seqAI([0]), seqAI([]), seqAI([0]), seqAI([])];
  const result = compareAIs(
    { timeLimitMs: 100, numPairs: 1, boardSize: 9, now: clock },
    () => ais[callIdx++],
  );
  expect(result.invalidMoves).toBe(2);
  expect(result.results[0].invalidMove?.reason).toBe('timeout');
  expect(result.results[1].invalidMove?.reason).toBe('timeout');
});

test('parseArgs - all flags parsed correctly, unknown flags ignored', () => {
  const opts = parseArgs(['--unknown', '--time', '50', '--pairs', '3', '--size', '11']);
  expect(opts.timeLimitMs).toBe(50);
  expect(opts.numPairs).toBe(3);
  expect(opts.boardSize).toBe(11);
});

test('parseArgs - defaults when no args provided', () => {
  const opts = parseArgs([]);
  expect(opts.timeLimitMs).toBe(100);
  expect(opts.numPairs).toBe(5);
  expect(opts.boardSize).toBe(9);
});

test('parseArgs - flags without values fall back to defaults', () => {
  const opts = parseArgs(['--time', '--pairs', '--size']);
  expect(opts.timeLimitMs).toBe(100);
  expect(opts.numPairs).toBe(5);
  expect(opts.boardSize).toBe(9);
});

test('formatResults - without invalid moves', () => {
  const result = {
    ai1Wins: 3, ai2Wins: 2, draws: 1, totalGames: 6, invalidMoves: 0, results: [],
  };
  const output = formatResults(result);
  expect(output).toContain('Results after 6 games:');
  expect(output).toContain('AI1 wins: 3 (50.0%)');
  expect(output).toContain('AI2 wins: 2 (33.3%)');
  expect(output).toContain('Draws: 1');
  expect(output).not.toContain('Invalid moves');
});

test('formatResults - with invalid moves', () => {
  const result = {
    ai1Wins: 0, ai2Wins: 1, draws: 0, totalGames: 1, invalidMoves: 1, results: [],
  };
  const output = formatResults(result);
  expect(output).toContain('Invalid moves detected: 1');
});

test('formatResults - zero totalGames returns 0.0% for all', () => {
  const result = {
    ai1Wins: 0, ai2Wins: 0, draws: 0, totalGames: 0, invalidMoves: 0, results: [],
  };
  const output = formatResults(result);
  expect(output).toContain('AI1 wins: 0 (0.0%)');
  expect(output).toContain('AI2 wins: 0 (0.0%)');
});

describe('main', () => {
  test('runs successfully when no invalid moves occur', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Pair 0, game A (ai1Color=1): AI1 BLACK plays BLACK_WIN → AI1 wins.
    // Pair 0, game B (ai1Color=2): AI2 BLACK plays BLACK_WIN → AI2 wins.
    let callIdx = 0;
    const ais = [seqAI(BLACK_WIN), seqAI(WHITE_IDLE), seqAI(WHITE_IDLE), seqAI(BLACK_WIN)];
    main(
      ['--pairs', '1', '--time', '100', '--size', '9'],
      () => ais[callIdx++],
    );
    // No invalid moves → process.exit is never called; reaching here is success
    vi.restoreAllMocks();
  });

  test('calls process.exit(1) when invalid moves are detected', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    main(['--pairs', '1', '--size', '9'], () => seqAI([-1]));

    expect(exitSpy).toHaveBeenCalledWith(1);
    vi.restoreAllMocks();
  });
});
