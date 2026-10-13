// @vitest-environment node
import { expect, test } from 'vitest';
import { seededRandom, pairedStatistics, runMatch } from '../scripts/strength-match.mjs';
import { playStrengthGame } from '../scripts/ai-strength.mjs';
import * as engine from '../src/engine';

test('seeded openings are reproducible and reject invalid seeds and bounds', () => {
  const a = seededRandom(123), b = seededRandom(123);
  expect(Array.from({ length: 100 }, () => a(25))).toEqual(Array.from({ length: 100 }, () => b(25)));
  expect(seededRandom(124)(1)).toBe(0);
  for (const seed of [0, -1, 1.5, NaN, 2 ** 32]) expect(() => seededRandom(seed)).toThrow('seed');
  for (const bound of [0, -1, 1.5]) expect(() => a(bound)).toThrow('bound');
});

test('paired exact two-sided test treats color swaps as one statistical unit', () => {
  expect(pairedStatistics([[1, -1], [0, 0]])).toMatchObject({ wins: 1, losses: 1, draws: 2, winRate: 0.25, scoreRate: 0.5, pValue: 1, passed: false });
  expect(pairedStatistics(Array.from({ length: 8 }, () => [1, 1]))).toMatchObject({ wins: 16, winRate: 1, pValue: 2 / 256, passed: true });
  expect(pairedStatistics(Array.from({ length: 8 }, () => [-1, -1]))).toMatchObject({ wins: 0, pValue: 2 / 256, passed: false });
  expect(pairedStatistics([[1, 0], [1, 1]])).toMatchObject({ wins: 3, draws: 1, pValue: 0.5, passed: false });
  // Eight correlated sweeps are significant; four are not, despite eight game wins.
  expect(pairedStatistics(Array.from({ length: 4 }, () => [1, 1])).pValue).toBe(0.125);
  expect(() => pairedStatistics([])).toThrow('pairs');
  for (const pair of [[1], [1, 2], [NaN, 0]]) expect(() => pairedStatistics([pair])).toThrow('pair');
});

test('fixed match completes its predeclared sample and supplies 75ms for both colors', () => {
  const calls: any[] = [], reports: any[] = [];
  const result = runMatch(engine, engine, { pairs: 8, seed: 42 }, r => reports.push(r), (_m, _c, opening, color, budget) => {
    calls.push({ opening, color, budget });
    return 1;
  });
  expect(result.passed).toBe(true);
  expect(result.moveMs).toBe(75);
  expect(result.seed).toBe(42);
  expect(result.results).toHaveLength(8);
  expect(reports).toHaveLength(8);
  expect(calls).toHaveLength(16);
  for (let i = 0; i < calls.length; i += 2) {
    expect(calls[i].opening).toBe(calls[i + 1].opening);
    expect(calls[i].color + calls[i + 1].color).toBe(3);
    expect(calls[i].budget).toBe(75);
  }
  for (const pairs of [0, -1, 1.5]) expect(() => runMatch(engine, engine, { pairs, seed: 42 })).toThrow('pairs');
});

test('game runner accepts the fixed match move budget for both engines', () => {
  const budgets: number[] = [];
  function sequence(moves: number[]) {
    return { ...engine, GogoAI: class {
      i = 0;
      findBestMove(_position: unknown, budget: number) { budgets.push(budget); return { move: moves[this.i++] }; }
    } };
  }
  expect(playStrengthGame(sequence([9, 18, 27, 36]), sequence([0, 1, 2, 3, 4]), 'B9', 1, 75)).toBe(1);
  expect(new Set(budgets)).toEqual(new Set([75]));
});

import { runMatchCli } from '../scripts/strength-match.mjs';
import { vi } from 'vitest';

test('default fixed sample uses 100 pairs without stopping or needing a reporter', () => {
  const result = runMatch(engine, engine, undefined, undefined, () => 0);
  expect(result.pairs).toBe(100);
  expect(result.seed).toBe(20261013);
  expect(result.draws).toBe(200);
});

// Lightweight protocol fixtures test the CLI independently of engine strength.
function cliEngine(move: number) {
  return {
    decodeGame: () => ({
      winner: 0, toMove: 1, isLegal: () => true, hasAnyLegalMove: () => true,
      play(value: number) {
        if (value === 1) this.winner = this.toMove;
        this.toMove = 3 - this.toMove;
        return true;
      },
      encodeGame: () => 'B9',
    }),
    GogoAI: class { findBestMove() { return { move }; } },
  };
}

test.each([true, false])('CLI reports complete JSON and success only when criteria pass (%s)', passed => {
  let loads = 0;
  const logs: string[] = [];
  expect(runMatchCli([process.cwd(), '8', '42'], () => cliEngine(loads++ === 0 || !passed ? 0 : 1), s => logs.push(s))).toBe(passed ? 0 : 1);
  expect(loads).toBe(2);
  const result = JSON.parse(logs[0]);
  expect(result.passed).toBe(passed);
  expect(result.results).toHaveLength(8);
});

test('CLI defaults and errors are reported without scoring incomplete games', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(runMatchCli([])).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(runMatchCli(['/nonexistent-match-master'])).toBe(2);
    let calls = 0;
    expect(runMatchCli([process.cwd()], () => cliEngine(++calls === 1 ? 0 : 1))).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0]).pairs).toBe(100);
  } finally { log.mockRestore(); }
});

test('CLI entry uses argv and propagates an operational failure exit code', async () => {
  const argv = process.argv, exitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.argv = [process.execPath, new URL('../scripts/strength-match.mjs', import.meta.url).pathname];
    vi.resetModules();
    await import('../scripts/strength-match.mjs');
    expect(process.exitCode).toBe(2);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    log.mockRestore();
    vi.resetModules();
  }
});

test('match records each engine’s first outcome signals, retaining the exact pre-move position', () => {
  const position = engine.decodeGame('B9 e5 d5');
  const result = runMatch(engine, engine, { pairs: 1, seed: 42 }, undefined,
    (_master, _candidate, _opening, _color, _budget, observe) => {
      const winning = { move: 31, forcedWin: true, forcedLoss: false, heuristicWin: true, heuristicLoss: false, depth: 3, nodes: 80 };
      observe(0, position, winning, 3.5);
      observe(0, position, winning, 8); // Do not repeat the same engine/flag.
      observe(1, position, winning, 2);
      observe(0, position, { ...winning, forcedWin: false, heuristicWin: false, forcedLoss: true, heuristicLoss: true }, 9);
      return 1;
    });
  const games = result.results[0].games;
  expect(games).toHaveLength(2);
  for (const game of games) {
    expect(game.signals).toHaveLength(3);
    expect(game.signals[0]).toMatchObject({ engine: 'master', flags: ['forcedWin', 'heuristicWin'], encoded: 'B9 e5 d5', elapsedMs: 3.5 });
    expect(game.signals[1]).toMatchObject({ engine: 'candidate', flags: ['forcedWin', 'heuristicWin'], elapsedMs: 2 });
    expect(game.signals[2].flags).toEqual(['forcedLoss', 'heuristicLoss']);
    expect(game.signals[0].result).toMatchObject({ move: 31, depth: 3, nodes: 80 });
  }
});

test('game observations are outside search and capture the untouched position and complete result', () => {
  const observed: any[] = [];
  function sequence(moves: number[]) {
    return { ...engine, GogoAI: class {
      i = 0;
      findBestMove() { return { move: moves[this.i++], forcedWin: true }; }
    } };
  }
  expect(playStrengthGame(sequence([9, 18, 27, 36]), sequence([0, 1, 2, 3, 4]), 'B9', 1, 75,
    (index, position, result, elapsedMs) => observed.push({ index, encoded: position.encodeGame(), result, elapsedMs }))).toBe(1);
  expect(observed).toHaveLength(9);
  expect(observed[0]).toMatchObject({ index: 1, encoded: 'B9', result: { move: 0, forcedWin: true } });
  expect(observed[1].encoded).toBe('B9 a1');
  expect(observed.every(r => r.elapsedMs >= 0)).toBe(true);
});

test('fixed match uses the app search settings and accepts a preselected balanced book', () => {
  const calls: any[] = [];
  const openings = ['B9 e5 d5', 'B9 d4 e4'];
  const result = runMatch(engine, engine, { pairs: 2, seed: 7, openings }, undefined,
    (...args: any[]) => { calls.push(args); return 0; });
  expect(result.results.map((r: any) => r.opening)).toEqual(openings);
  expect(result.searchOptions).toEqual({ maxDepth: 30, quiescenceDepth: 4, maxPly: 96 });
  expect(calls[0][6]).toEqual(result.searchOptions);
  expect(() => runMatch(engine, engine, { pairs: 3, openings }, undefined, () => 0)).toThrow('book');
});

test('game runner passes explicit search options to both engines', () => {
  const settings: any[] = [];
  const options = { maxDepth: 30, quiescenceDepth: 4, maxPly: 96 };
  function sequence(moves: number[]) {
    return { ...engine, GogoAI: class {
      i = 0;
      constructor(opts: unknown) { settings.push(opts); }
      findBestMove() { return { move: moves[this.i++] }; }
    } };
  }
  expect(playStrengthGame(sequence([9, 18, 27, 36]), sequence([0, 1, 2, 3, 4]), 'B9', 1, 75, undefined, options)).toBe(1);
  expect(settings).toEqual([options, options]);
});

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI accepts a saved master-only opening book', () => {
  const folder = mkdtempSync(join(tmpdir(), 'gomoku-book-'));
  try {
    const path = join(folder, 'book.json');
    writeFileSync(path, JSON.stringify({ entries: [{ opening: 'B9 e5 d5' }] }));
    const logs: string[] = [];
    expect(runMatchCli([process.cwd(), '1', '42', path], () => cliEngine(1), s => logs.push(s))).toBe(1);
    expect(JSON.parse(logs[0]).results[0].opening).toBe('B9 e5 d5');
    writeFileSync(path, 'invalid');
    expect(runMatchCli([process.cwd(), '1', '42', path], () => cliEngine(1), () => {})).toBe(2);
  } finally {
    rmSync(folder, { recursive: true });
  }
});
