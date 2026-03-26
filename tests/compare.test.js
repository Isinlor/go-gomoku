import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAIConfig,
  playGame,
  compareAIs,
  parseArgs,
  formatResults,
  main,
} from '../browser-demo/build/src/compare.js';

// Helper: create a mock AI that plays a fixed sequence of moves (returns -1 when exhausted)
function seqAI(moves) {
  let i = 0;
  return { findBestMove: () => ({ move: moves[i++] ?? -1 }) };
}

// On a 9x9 board (size=9), index = y*9 + x.
// A horizontal win for BLACK: indices 0,1,2,3,4 (row 0, columns 0-4).
// Interleaved with WHITE at 9,18,27,36 (column 0, rows 1-4 – never reaches 5 in a row).
const BLACK_WIN = [0, 1, 2, 3, 4];
const WHITE_IDLE = [9, 18, 27, 36];

test('parseAIConfig handles all branches', () => {
  // !spec true (empty string)
  assert.deepEqual(parseAIConfig(''), {});

  // spec === 'default'
  assert.deepEqual(parseAIConfig('default'), {});

  // key === 'maxDepth' (first || arm true)
  assert.deepEqual(parseAIConfig('maxDepth:6'), { maxDepth: 6 });

  // key === 'depth' (first || arm false, second arm true)
  assert.deepEqual(parseAIConfig('depth:4'), { maxDepth: 4 });

  // key === 'quiescenceDepth' (second if first arm true)
  assert.deepEqual(parseAIConfig('quiescenceDepth:3'), { quiescenceDepth: 3 });

  // key === 'quiescence' (second if first arm false, second arm true)
  assert.deepEqual(parseAIConfig('quiescence:2'), { quiescenceDepth: 2 });

  // unknown key (both conditions false)
  assert.deepEqual(parseAIConfig('unknown:5'), {});

  // part without colon (colonIdx === -1, continue branch)
  assert.deepEqual(parseAIConfig('nocolon'), {});

  // multiple parts: verify accumulation
  assert.deepEqual(parseAIConfig('maxDepth:6,quiescence:2'), { maxDepth: 6, quiescenceDepth: 2 });
});

test('playGame - AI1 wins when playing BLACK and completing a five-in-a-row', () => {
  // ai1Color=BLACK=1; AI1 plays 0,1,2,3,4 (row 0), AI2 plays non-winning moves
  const result = playGame(seqAI(BLACK_WIN), seqAI(WHITE_IDLE), 100, 1, 9);
  assert.equal(result.winner, 1);
  assert.equal(result.ai1Color, 1);
  assert.equal(result.moves, 9);
  assert.equal(result.invalidMove, undefined);
});

test('playGame - AI2 wins when playing BLACK (ai1Color=WHITE)', () => {
  // ai1Color=WHITE=2; BLACK goes first → AI2 plays first
  const result = playGame(seqAI(WHITE_IDLE), seqAI(BLACK_WIN), 100, 2, 9);
  assert.equal(result.winner, 2);
  assert.equal(result.ai1Color, 2);
  assert.equal(result.invalidMove, undefined);
});

test('playGame - draw when both AIs immediately pass', () => {
  const result = playGame(seqAI([-1]), seqAI([-1]), 100, 1, 9);
  assert.equal(result.winner, 0);
  assert.equal(result.moves, 0);
  assert.equal(result.invalidMove, undefined);
});

test('playGame - AI1 invalid move on first turn gives win to AI2', () => {
  // AI1 returns an out-of-bounds index on its very first move
  const result = playGame(seqAI([9999]), seqAI(WHITE_IDLE), 100, 1, 9);
  assert.equal(result.winner, 2);
  assert.equal(result.moves, 0);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 1);
  assert.equal(result.invalidMove.move, 9999);
});

test('playGame - AI2 invalid move (occupied cell) gives win to AI1', () => {
  // AI1 plays cell 0 (valid), then AI2 tries to play cell 0 (occupied → illegal)
  const result = playGame(seqAI([0]), seqAI([0]), 100, 1, 9);
  assert.equal(result.winner, 1);
  assert.equal(result.moves, 1);
  assert.ok(result.invalidMove !== undefined);
  assert.equal(result.invalidMove.ai, 2);
  assert.equal(result.invalidMove.move, 0);
});

test('compareAIs - covers all winner outcomes with mock factory', () => {
  const ai1Config = { maxDepth: 1 };
  const ai2Config = { maxDepth: 2 };

  // Game 0 (i=0, ai1Color=BLACK): AI1 wins
  // Game 1 (i=1, ai1Color=WHITE): AI2 wins (AI2 is BLACK, plays first, wins)
  // Game 2 (i=2, ai1Color=BLACK): draw (both pass)
  const ai1Seqs = [BLACK_WIN, WHITE_IDLE, [-1]];
  const ai2Seqs = [WHITE_IDLE, BLACK_WIN, [-1]];

  let ai1Idx = 0;
  let ai2Idx = 0;
  const factory = (config) => {
    if (config === ai1Config) return seqAI(ai1Seqs[ai1Idx++]);
    return seqAI(ai2Seqs[ai2Idx++]);
  };

  const result = compareAIs({ ai1Config, ai2Config, timeLimitMs: 100, numGames: 3, boardSize: 9 }, factory);

  assert.equal(result.ai1Wins, 1);
  assert.equal(result.ai2Wins, 1);
  assert.equal(result.draws, 1);
  assert.equal(result.totalGames, 3);
  assert.equal(result.invalidMoves, 0);
  assert.equal(result.results.length, 3);
  // Verify alternating colors for fairness
  assert.equal(result.results[0].ai1Color, 1);
  assert.equal(result.results[1].ai1Color, 2);
  assert.equal(result.results[2].ai1Color, 1);
});

test('compareAIs - counts invalid moves and records them in results', () => {
  const badConfig = { maxDepth: 99 };
  const goodConfig = { maxDepth: 1 };

  // Game 0 (i=0, ai1Color=BLACK): AI1 returns invalid move immediately
  const result = compareAIs(
    { ai1Config: badConfig, ai2Config: goodConfig, timeLimitMs: 100, numGames: 1, boardSize: 9 },
    (config) => config === badConfig ? seqAI([9999]) : seqAI([-1]),
  );

  assert.equal(result.invalidMoves, 1);
  assert.equal(result.ai2Wins, 1);
  assert.ok(result.results[0].invalidMove !== undefined);
});

test('compareAIs - uses default GogoAI factory when none provided', () => {
  // numGames:1 forces the lambda inside the ?? to be called, creating a real GogoAI
  const result = compareAIs({
    ai1Config: { maxDepth: 1 },
    ai2Config: { maxDepth: 1 },
    timeLimitMs: 10,
    numGames: 1,
    boardSize: 9,
  });
  assert.equal(result.totalGames, 1);
  assert.equal(result.ai1Wins + result.ai2Wins + result.draws, 1);
});

test('parseArgs - all flags parsed correctly', () => {
  // Include an unknown flag to cover the all-false branch of the if/else-if chain
  const opts = parseArgs([
    '--unknown',
    '--ai1', 'depth:3',
    '--ai2', 'quiescence:2',
    '--time', '50',
    '--games', '5',
    '--size', '11',
  ]);
  assert.deepEqual(opts.ai1Config, { maxDepth: 3 });
  assert.deepEqual(opts.ai2Config, { quiescenceDepth: 2 });
  assert.equal(opts.timeLimitMs, 50);
  assert.equal(opts.numGames, 5);
  assert.equal(opts.boardSize, 11);
});

test('parseArgs - defaults when no args provided', () => {
  const opts = parseArgs([]);
  assert.deepEqual(opts.ai1Config, {});
  assert.deepEqual(opts.ai2Config, {});
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
  // Use distinct maxDepth values so the factory can route each AI to the right sequence.
  // ai1Config will have maxDepth:1 (BLACK wins sequence), ai2Config maxDepth:2 (idle sequence).
  main(
    ['--games', '1', '--time', '100', '--size', '9', '--ai1', 'maxDepth:1', '--ai2', 'maxDepth:2'],
    (config) => config.maxDepth === 1 ? seqAI(BLACK_WIN) : seqAI(WHITE_IDLE),
  );
  // No invalid moves → process.exit is never called; reaching here is success
});

test('main - calls process.exit(1) when invalid moves are detected', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const exitMock = t.mock.method(process, 'exit', () => {});

  main(['--games', '1', '--size', '9'], () => seqAI([9999]));

  assert.equal(exitMock.mock.calls.length, 1);
  assert.equal(exitMock.mock.calls[0].arguments[0], 1);
});
