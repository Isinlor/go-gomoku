// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as engine from '../src/engine';
import { seededRandom, APP_SEARCH_OPTIONS } from '../scripts/strength-match.mjs';
import { createBookOpening, screenMasterOpening, sampleBookOpening, buildBalancedBook, runBookCli } from '../scripts/balanced-openings.mjs';

test('book openings use reproducible even-length central moves', () => {
  const a = createBookOpening(engine, seededRandom(42));
  const b = createBookOpening(engine, seededRandom(42));
  expect(a.encodeGame()).toBe(b.encodeGame());
  expect(a.ply).toBeGreaterThanOrEqual(6);
  expect(a.ply).toBeLessThanOrEqual(24);
  expect(a.ply % 2).toBe(0);
  expect(a.toMove).toBe(1);
  for (let p = 0; p < a.area; p++) {
    if (a.board[p] !== 0) {
      expect(p % 9).toBeGreaterThanOrEqual(1);
      expect(p % 9).toBeLessThanOrEqual(7);
      expect(Math.floor(p / 9)).toBeGreaterThanOrEqual(1);
      expect(Math.floor(p / 9)).toBeLessThanOrEqual(7);
    }
  }
});

test('random setup stops if a generated move wins', () => {
  const wanted = [10, 19, 11, 20, 12, 21, 13, 22, 14];
  const available = Array.from({ length: 49 }, (_, i) => (1 + Math.floor(i / 7)) * 9 + 1 + i % 7);
  let call = 0;
  const position = createBookOpening(engine, () => {
    if (call++ === 0) return 2; // Ten plies, but Black wins on ply nine.
    const index = available.indexOf(wanted.shift()!);
    available.splice(index, 1);
    return index;
  });
  expect(position.ply).toBe(9);
  expect(position.winner).toBe(1);
  expect(screenMasterOpening(engine, position)).toBeNull();
  expect(screenMasterOpening(engine, engine.decodeGame('B9 a1'))).toBeNull();
});

function sequence(moves: number[], flags = {}) {
  const calls: any[] = [];
  return { ...engine, calls, GogoAI: class {
    index = 0;
    constructor(options: unknown) { calls.push({ options }); }
    findBestMove(position: any, ms: number) {
      calls.push({ encoded: position.encodeGame(), ms });
      return { move: moves[this.index++], score: 123, depth: 3, ...flags };
    }
  } };
}

test('master-only selfplay records the opening, screen and winner with app options', () => {
  const master = sequence([0, 9, 1, 18, 2, 27, 3, 36, 4]);
  expect(screenMasterOpening(master, engine.decodeGame('B9'))).toEqual({
    opening: 'B9', masterWinner: 1, screenScore: 123, screenDepth: 3,
  });
  expect(master.calls[0].options).toEqual(APP_SEARCH_OPTIONS);
  expect(master.calls.slice(1)).toHaveLength(9); // Initial screen reused for the first move.
  expect(master.calls.slice(1).every(c => c.ms === 75)).toBe(true);
});

test.each(['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss'])('book rejects a master %s at the starting position', flag => {
  expect(screenMasterOpening(sequence([0], { [flag]: true }), engine.decodeGame('B9'))).toBeNull();
});

test('selfplay rejects illegal search results and unresolved games', () => {
  expect(() => screenMasterOpening(sequence([-1]), engine.decodeGame('B9'))).toThrow('illegal');
  const full = { ...engine.decodeGame('B9'), winner: 0, toMove: 1,
    encodeGame: () => 'B9', hasAnyLegalMove: () => false };
  expect(screenMasterOpening(sequence([0]), full)).toBeNull();
  const endless = { ...full, hasAnyLegalMove: () => true, isLegal: () => true, play: () => true };
  const master = sequence(Array(120).fill(0));
  expect(screenMasterOpening(master, endless)).toBeNull();
  expect(master.calls.slice(1)).toHaveLength(120);
});

test('default sampler constructs an opening before master-only screening', () => {
  const master = sequence([0], { heuristicWin: true });
  expect(sampleBookOpening(master, seededRandom(123))).toBeNull();
  expect(master.calls[1].encoded).toMatch(/^B9 /);
});

test('balanced collection skips rejected and surplus games, interleaves winners and records provenance', () => {
  const samples = [null, ...[1, 1, 1, 2, 2].map((winner, i) => ({
    opening: `opening-${i}`, masterWinner: winner, screenScore: i, screenDepth: 3,
  }))];
  const reports: any[] = [];
  const book = buildBalancedBook(engine, { perColor: 2, seed: 42, maxAttempts: 6, masterRevision: 'baseline' },
    p => reports.push(p), () => samples.shift());
  expect(book).toMatchObject({ master: 'baseline', seed: 42, moveMs: 75, searchOptions: APP_SEARCH_OPTIONS,
    attempted: 6, black: 2, white: 2 });
  expect(book.entries.map(e => e.opening)).toEqual(['opening-0', 'opening-3', 'opening-1', 'opening-4']);
  expect(book.entries.map(e => e.order)).toEqual([0, 1, 2, 3]);
  expect(reports.at(-1)).toEqual({ attempted: 6, black: 2, white: 2 });
  expect(reports).toHaveLength(5);
});

test('collection validates fixed targets, seed and attempt budget and fails rather than returning an incomplete book', () => {
  for (const perColor of [0, -1, 1.5]) expect(() => buildBalancedBook(engine, { perColor })).toThrow('color');
  for (const maxAttempts of [0, -1, 1.5, 1]) expect(() => buildBalancedBook(engine, { perColor: 1, maxAttempts })).toThrow('attempt');
  expect(() => buildBalancedBook(engine, { seed: 0 })).toThrow('seed');
  expect(() => buildBalancedBook(engine, { perColor: 1, maxAttempts: 2 }, undefined, () => null)).toThrow('Incomplete book');
  expect(() => buildBalancedBook(sequence([0], { forcedWin: true }), { perColor: 1, maxAttempts: 2 })).toThrow('Incomplete book');
  let index = 0;
  expect(buildBalancedBook(engine, undefined, undefined, () => ({ masterWinner: 1 + index++ % 2 }))).toMatchObject({ black: 50, white: 50, master: null });
});

test('CLI uses only the specified master checkout and reports JSON separately from progress', () => {
  const logs: string[] = [], progress: any[] = [], loads: string[] = [], options: any[] = [];
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  expect(runBookCli([process.cwd(), '1', '42', '2'], path => { loads.push(path); return engine; },
    s => logs.push(s), p => progress.push(p), (master, settings, report) => {
      expect(master).toBe(engine);
      options.push(settings);
      report({ attempted: 2, black: 1, white: 1 });
      return { entries: ['book'] };
    })).toBe(0);
  expect(loads).toEqual([process.cwd()]);
  expect(options[0]).toEqual({ perColor: 1, seed: 42, maxAttempts: 2, masterRevision: revision });
  expect(JSON.parse(logs[0])).toEqual({ entries: ['book'] });
  expect(progress).toEqual([{ attempted: 2, black: 1, white: 1 }]);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(runBookCli([process.cwd()], undefined, undefined, undefined, (_master, settings, report) => {
      expect(settings).toMatchObject({ perColor: 50, seed: 2026101501, maxAttempts: 1000 });
      report({ attempted: 1 });
      return {};
    })).toBe(0);
    expect(error).toHaveBeenCalledWith('{"attempted":1}');
    expect(runBookCli([process.cwd(), '1', '42', '2'], () => sequence([0], { forcedWin: true }))).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Incomplete book'));
  } finally { log.mockRestore(); error.mockRestore(); }
});

test('CLI entry reports missing arguments as an operational error', async () => {
  const argv = process.argv, exitCode = process.exitCode;
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    process.argv = [process.execPath, new URL('../scripts/balanced-openings.mjs', import.meta.url).pathname];
    vi.resetModules();
    await import('../scripts/balanced-openings.mjs');
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    error.mockRestore();
    vi.resetModules();
  }
});
