import test from 'node:test';
import assert from 'node:assert/strict';

import { GogoPosition } from '../browser-demo/build/src/index.js';
import {
  playGame,
  compareAIs,
  parseArgs,
  formatResults,
  main,
} from '../browser-demo/build/src/compare.js';

// Helper: create a mock AI that plays a fixed sequence of moves
function seqAI(moves) {
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
  assert.equal(result.winner, 1);
  assert.equal(result.ai1Color, 1);
  assert.equal(result.moves, 9);
  assert.equal(result.invalidMove, undefined);
});

test('playGame - AI2 wins when playing BLACK (ai1Color=WHITE)', () => {
  // AI1 is WHITE; BLACK (= AI2) goes first and wins.
  const result = playGame(seqAI(WHITE_IDLE), seqAI(BLACK_WIN), 100, 2, new GogoPosition(9));
  assert.equal(result.winner, 2);
  assert.equal(result.ai1Color, 2);
  assert.equal(result.invalidMove, undefined);
});

test('playGame - draw when no legal moves remain before any AI is called', () => {
  // Full board with no winner: hasAnyLegalMove() is false on the very first loop
  // iteration, so the loop breaks immediately and the game is a draw.
  // A fresh GogoPosition is needed here only for the ai1Color parameter; the board
  // state actually checked is FULL_BOARD_NO_WINNER.
  const result = playGame(seqAI([]), seqAI([]), 100, 1, FULL_BOARD_NO_WINNER);
  assert.equal(result.winner, 0);
  assert.equal(result.moves, 0);
  assert.equal(result.invalidMove, undefined);
});

test('playGame - AI1 invalid move: returns -1 when legal moves exist (refused)', () => {
  // On an empty board legal moves exist, so returning -1 is a protocol violation.
  const result = playGame(seqAI([-1]), seqAI(WHITE_IDLE), 100, 1, new GogoPosition(9));
  assert.equal(result.winner, 2);
  assert.equal(result.moves, 0);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 1);
  assert.equal(result.invalidMove.move, -1);
  assert.equal(result.invalidMove.reason, 'refused');
});

test('playGame - AI2 invalid move: returns -1 when legal moves exist (refused)', () => {
  // AI1 plays one valid move, then AI2 refuses to play on an otherwise legal board.
  const result = playGame(seqAI([0]), seqAI([-1]), 100, 1, new GogoPosition(9));
  assert.equal(result.winner, 1);
  assert.equal(result.moves, 1);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 2);
  assert.equal(result.invalidMove.reason, 'refused');
});

test('playGame - AI1 invalid move: returns an illegal move index', () => {
  // Out-of-bounds index is never legal.
  const result = playGame(seqAI([9999]), seqAI(WHITE_IDLE), 100, 1, new GogoPosition(9));
  assert.equal(result.winner, 2);
  assert.equal(result.moves, 0);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 1);
  assert.equal(result.invalidMove.move, 9999);
  assert.equal(result.invalidMove.reason, 'illegal');
});

test('playGame - AI2 invalid move: plays an occupied cell', () => {
  // AI1 plays cell 0 (valid), then AI2 attempts to play the same cell.
  const result = playGame(seqAI([0]), seqAI([0]), 100, 1, new GogoPosition(9));
  assert.equal(result.winner, 1);
  assert.equal(result.moves, 1);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 2);
  assert.equal(result.invalidMove.move, 0);
  assert.equal(result.invalidMove.reason, 'illegal');
});

test('playGame - AI1 timeout: wall clock exceeds limit before result is used', () => {
  // Mock clock: start=0, then jumps to 1000 after findBestMove returns.
  // elapsed = 1000 - 0 = 1000 > timeLimitMs=100 → timeout for AI1.
  let call = 0;
  const clock = () => (call++ === 0 ? 0 : 1000);
  const result = playGame(seqAI([0]), seqAI([0]), 100, 1, new GogoPosition(9), clock);
  assert.equal(result.winner, 2);
  assert.equal(result.moves, 0);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 1);
  assert.equal(result.invalidMove.reason, 'timeout');
});

test('playGame - AI2 timeout: time limit triggered on AI2 turn', () => {
  // AI1 plays one valid move (clock at 0→0, no timeout), then AI2 exceeds the limit.
  let call = 0;
  // Calls: start_ai1=0, end_ai1=0 (ok), start_ai2=0, end_ai2=1000 (timeout)
  const clock = () => [0, 0, 0, 1000][call++] ?? 0;
  const result = playGame(seqAI([0]), seqAI([40]), 100, 1, new GogoPosition(9), clock);
  assert.equal(result.winner, 1);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 2);
  assert.equal(result.invalidMove.reason, 'timeout');
});

test('compareAIs - AI1 wins and AI2 wins outcomes with mock factory', () => {
  // Game 0 (i=0, ai1Color=BLACK=1): AI1 is BLACK → plays BLACK_WIN → AI1 wins
  // Game 1 (i=1, ai1Color=WHITE=2): AI1 is WHITE, AI2 is BLACK → AI2 plays BLACK_WIN → AI2 wins
  let callIdx = 0;
  const ais = [seqAI(BLACK_WIN), seqAI(WHITE_IDLE), seqAI(WHITE_IDLE), seqAI(BLACK_WIN)];
  const result = compareAIs(
    { timeLimitMs: 100, numGames: 2, boardSize: 9 },
    () => ais[callIdx++],
  );
  assert.equal(result.ai1Wins, 1);
  assert.equal(result.ai2Wins, 1);
  assert.equal(result.draws, 0);
  assert.equal(result.totalGames, 2);
  assert.equal(result.invalidMoves, 0);
  // Verify alternating colors for fairness
  assert.equal(result.results[0].ai1Color, 1);
  assert.equal(result.results[1].ai1Color, 2);
});

test('compareAIs - draw outcome via full board with no winner', () => {
  // Inject the pre-filled board so hasAnyLegalMove() returns false immediately.
  const result = compareAIs(
    { timeLimitMs: 100, numGames: 1, boardSize: 9 },
    () => seqAI([]),
    () => FULL_BOARD_NO_WINNER,
  );
  assert.equal(result.draws, 1);
  assert.equal(result.ai1Wins, 0);
  assert.equal(result.ai2Wins, 0);
  assert.equal(result.totalGames, 1);
  assert.equal(result.invalidMoves, 0);
});

test('compareAIs - counts invalid moves and records them in results', () => {
  // Game 0 (i=0, ai1Color=BLACK): AI1 is BLACK, immediately returns -1 (refused)
  let callIdx = 0;
  const result = compareAIs(
    { timeLimitMs: 100, numGames: 1, boardSize: 9 },
    () => callIdx++ === 0 ? seqAI([-1]) : seqAI([]),
  );
  assert.equal(result.invalidMoves, 1);
  assert.equal(result.ai2Wins, 1);
  assert.ok(result.results[0].invalidMove !== undefined);
  assert.equal(result.results[0].invalidMove.reason, 'refused');
});

test('compareAIs - uses default GogoAI factory when none provided', () => {
  const result = compareAIs({ timeLimitMs: 10, numGames: 1, boardSize: 9 });
  assert.equal(result.totalGames, 1);
  assert.equal(result.ai1Wins + result.ai2Wins + result.draws, 1);
});

test('compareAIs - passes options.now clock to playGame for timeout enforcement', () => {
  // Make every AI call appear to violate the time limit.
  let call = 0;
  const clock = () => (call++ % 2 === 0 ? 0 : 1000);
  let callIdx = 0;
  const result = compareAIs(
    { timeLimitMs: 100, numGames: 1, boardSize: 9, now: clock },
    () => callIdx++ === 0 ? seqAI([0]) : seqAI([]),
  );
  assert.equal(result.invalidMoves, 1);
  assert.ok(result.results[0].invalidMove?.reason === 'timeout');
});

test('parseArgs - all flags parsed correctly, unknown flags ignored', () => {
  const opts = parseArgs(['--unknown', '--time', '50', '--games', '5', '--size', '11']);
  assert.equal(opts.timeLimitMs, 50);
  assert.equal(opts.numGames, 5);
  assert.equal(opts.boardSize, 11);
});

test('parseArgs - defaults when no args provided', () => {
  const opts = parseArgs([]);
  assert.equal(opts.timeLimitMs, 100);
  assert.equal(opts.numGames, 10);
  assert.equal(opts.boardSize, 9);
});

test('formatResults - without invalid moves', () => {
  const result = {
    ai1Wins: 3, ai2Wins: 2, draws: 1, totalGames: 6, invalidMoves: 0, results: [],
  };
  const output = formatResults(result);
  assert.ok(output.includes('Results after 6 games:'));
  assert.ok(output.includes('AI1 wins: 3 (50.0%)'));
  assert.ok(output.includes('AI2 wins: 2 (33.3%)'));
  assert.ok(output.includes('Draws: 1'));
  assert.ok(!output.includes('Invalid moves'));
});

test('formatResults - with invalid moves', () => {
  const result = {
    ai1Wins: 0, ai2Wins: 1, draws: 0, totalGames: 1, invalidMoves: 1, results: [],
  };
  const output = formatResults(result);
  assert.ok(output.includes('Invalid moves detected: 1'));
});

test('formatResults - zero totalGames returns 0.0% for all', () => {
  const result = {
    ai1Wins: 0, ai2Wins: 0, draws: 0, totalGames: 0, invalidMoves: 0, results: [],
  };
  const output = formatResults(result);
  assert.ok(output.includes('AI1 wins: 0 (0.0%)'));
  assert.ok(output.includes('AI2 wins: 0 (0.0%)'));
});

test('main - runs successfully when no invalid moves occur', (t) => {
  t.mock.method(console, 'log', () => {});
  let callIdx = 0;
  main(
    ['--games', '1', '--time', '100', '--size', '9'],
    () => callIdx++ === 0 ? seqAI(BLACK_WIN) : seqAI(WHITE_IDLE),
  );
  // No invalid moves → process.exit is never called; reaching here is success
});

test('main - calls process.exit(1) when invalid moves are detected', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const exitMock = t.mock.method(process, 'exit', () => {});

  main(['--games', '1', '--size', '9'], () => seqAI([-1]));

  assert.equal(exitMock.mock.calls.length, 1);
  assert.equal(exitMock.mock.calls[0].arguments[0], 1);
});