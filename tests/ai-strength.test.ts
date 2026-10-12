// @vitest-environment node
import { expect, test } from 'vitest';
import { comparePairs } from '../scripts/ai-strength.mjs';

test('uses an anytime-valid mixture and retains half-point pair margins', () => {
  expect(comparePairs([])).toMatchObject({ wins: 0, losses: 0, ties: 0, evidence: 1, passed: true });
  expect(comparePairs([0, 0]).evidence).toBe(1);
  expect(comparePairs([-1]).evidence).toBeCloseTo(1 + 2.15 / 6);
  expect(comparePairs([-0.5]).evidence).toBeCloseTo(1 + 2.15 / 12);
  expect(comparePairs(Array(7).fill(-1)).passed).toBe(true);
  expect(comparePairs(Array(8).fill(-1)).passed).toBe(false);
  // Crossing the boundary remains a rejection even if later games recover.
  expect(comparePairs([...Array(8).fill(-1), ...Array(30).fill(1)]).passed).toBe(false);
  expect(comparePairs(Array(5000).fill(-1)).passed).toBe(false);
  expect(comparePairs([1, 0.5])).toMatchObject({ wins: 2, losses: 0, evidence: 1, passed: true });
});

test('rejects invalid pair outcomes', () => {
  expect(() => comparePairs([2])).toThrow('outcome');
});

import * as engine from '../src/engine';
import { benchmarkStrength, makeOpening, playGame, seededRandom, runStrength, MAX_PLIES, SAMPLE_TIME_MS } from '../scripts/ai-strength.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { vi } from 'vitest';

const check = () => {};

test('seeded openings reproduce legal positions on all supported sizes', () => {
  const first = seededRandom(123), second = seededRandom(123);
  for (const size of [9, 11, 13]) {
    const opening = makeOpening(engine, first, size);
    expect(opening).toBe(makeOpening(engine, second, size));
    const position = engine.decodeGame(opening);
    expect(position.winner).toBe(0);
    expect(position.ply).toBeGreaterThanOrEqual(4);
    expect(position.ply).toBeLessThanOrEqual(12);
  }
  expect(engine.decodeGame(makeOpening(engine, () => 0, 9)).getMoveAt(0)).toBe(0);
  expect(engine.decodeGame(makeOpening(engine, (limit: number) => limit - 1, 13)).getMoveAt(0)).toBe(168);
  for (const seed of [0, -1, NaN, 1.5, 0x100000000]) expect(() => seededRandom(seed)).toThrow('Seed');
});

test('discards an opening move that wins and rejects malformed opening rules', () => {
  const remaining = Array.from({ length: 25 }, (_, i) => (2 + Math.floor(i / 5)) * 9 + 2 + i % 5);
  const targets = [20, 56, 21, 57, 22, 58, 23, 59, 24];
  let calls = 0;
  const opening = makeOpening(engine, () => {
    if (calls++ < 2) return 2;
    if (calls === 3) return 8;
    const index = remaining.indexOf(targets.shift()!);
    remaining.splice(index, 1);
    return index;
  }, 9);
  expect(engine.decodeGame(opening).winner).toBe(0);
  expect(engine.decodeGame(opening).ply).toBe(8);
  expect(() => makeOpening({ decodeGame: () => ({ isLegal: () => false }) }, () => 0, 9)).toThrow('No legal');
  expect(() => makeOpening({ decodeGame: () => ({ isLegal: () => true, play: () => false }) }, () => 0, 9)).toThrow('Illegal opening');
});

test('collects more than 32 pairs until the sampling deadline, shares openings, and swaps colors', () => {
  let elapsed = 0;
  const history: any[][] = [], logs: string[] = [];
  const play = (...args: any[]) => { history.push(args); elapsed += 10; return 0; };
  expect(benchmarkStrength(engine, engine, 123, (s: string) => logs.push(s), () => elapsed, play, SAMPLE_TIME_MS)).toBe(0);
  expect(history.length / 2).toBe(SAMPLE_TIME_MS / 20);
  expect(history.length / 2).toBeGreaterThan(32);
  for (let i = 0; i < history.length; i += 2) {
    expect(history[i][2]).toBe(history[i + 1][2]);
    expect(history[i][3] + history[i + 1][3]).toBe(3);
  }
  expect(logs.join(' ')).toContain('PASS');
});

test('uses fractional pair scores and confirms loss evidence at the deadline', () => {
  let elapsed = 0, calls = 0;
  const logs: string[] = [];
  const play = () => { elapsed += 10; return calls++ % 2 === 0 ? -1 : 0; };
  expect(benchmarkStrength(engine, engine, 123, (s: string) => logs.push(s), () => elapsed, play, 400)).toBe(1);
  expect(logs.join(' ')).toContain('20 lost');
});

test('discards a deadline-interrupted pair but propagates invalid-engine errors', () => {
  let elapsed = 0, calls = 0;
  const logs: string[] = [];
  const play = (...args: any[]) => {
    if (++calls <= 2) { elapsed += 1; return 0; }
    elapsed = 13000;
    args[4]();
    return -1;
  };
  expect(benchmarkStrength(engine, engine, 123, (s: string) => logs.push(s), () => elapsed, play, 12000)).toBe(0);
  expect(logs.join(' ')).toContain('1 tied');
  expect(logs.join(' ')).toContain('unfinished pair');
  expect(() => benchmarkStrength(engine, engine, 123, check, () => 0, () => { throw Error('illegal move'); }, 100)).toThrow('illegal move');
  expect(() => benchmarkStrength(engine, engine, 123, check, () => 13000, play, 12000)).toThrow('No complete');
});

test('defaults to the real wall clock and a twelve-second sampling window', () => {
  let elapsed = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed += 100);
  try {
    expect(benchmarkStrength(engine, engine, 123, check, undefined, () => 0)).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(SAMPLE_TIME_MS);
  } finally { clock.mockRestore(); }
});

test('both engines use the same fixed milliseconds per move and their real clocks', () => {
  const budgets: number[] = [], options: unknown[] = [];
  class RecordingAI extends engine.GogoAI {
    constructor(value: unknown) { super(value); options.push(value); }
    findBestMove(position: any, milliseconds: number) {
      budgets.push(milliseconds);
      // Exercise the real solver, but fix the reply so this plumbing test
      // cannot depend on how far the search gets on a busy runner.
      return { ...super.findBestMove(position, milliseconds), move: 24 };
    }
  }
  const recording = { ...engine, GogoAI: RecordingAI };
  // The fixed legal reply completes black’s five in both games.
  const opening = 'B9 c3 c7 d3 d7 e3 e7 f3 f7';
  expect(playGame(recording, recording, opening, 1, check)).toBe(1);
  expect(playGame(recording, recording, opening, 2, check)).toBe(-1);
  expect(budgets).toEqual([2, 2]);
  expect(options).toEqual(Array(4).fill({ maxDepth: 64, quiescenceDepth: 6 }));
});

// Tiny deterministic rules exercise draw and invalid-engine paths without clocks or mocks.
function rules(move: number, legal: boolean, playable: boolean) {
  return {
    decodeGame: () => ({ toMove: 1, winner: 0, play: () => legal, hasAnyLegalMove: () => playable }),
    GogoAI: class { findBestMove() { return { move }; } },
  };
}

test('counts move caps and no legal moves as draws; rejects invalid AI replies', () => {
  const capped = rules(0, true, true);
  let checks = 0;
  expect(playGame(capped, capped, '', 1, () => checks++)).toBe(0);
  expect(checks).toBe(MAX_PLIES);
  const blocked = rules(-1, false, false);
  expect(playGame(blocked, blocked, '', 2, check)).toBe(0);
  const missing = rules(-1, false, true);
  expect(() => playGame(missing, missing, '', 1, check)).toThrow('no move');
  const illegal = rules(0, false, true);
  expect(() => playGame(illegal, illegal, '', 1, check)).toThrow('illegal move');
  expect(() => playGame(capped, capped, '', 1, () => { throw Error('deadline'); })).toThrow('deadline');
});

function fixture(fastClock = false) {
  const root = mkdtempSync(join(tmpdir(), 'ai-strength-'));
  const dir = join(root, 'src/engine');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gogomoku.ts'), `
    export function decodeGame(encoded) {
      return { toMove: 1, winner: 0, isLegal: () => true, play: () => true,
        encodeGame: () => encoded, hasAnyLegalMove: () => false };
    }
    export function decodeMove() { return 0; }
  `);
  writeFileSync(join(dir, 'ai.ts'), `${fastClock ? 'let ticks = 0; performance.now = () => ++ticks * 1000;' : ''}
    export class GogoAI { findBestMove() { return { move: -1 }; } }`);
  writeFileSync(join(dir, 'puzzles.ts'), 'export const PUZZLES = [];');
  return root;
}

test('runner loads separate checkouts, prints timings, and returns errors without retrying', () => {
  const root = fixture(), other = fixture(), logs: string[] = [];
  const log = (s: string) => logs.push(s);
  try {
    let elapsed = 0;
    const clock = () => elapsed += 100;
    expect(runStrength(root, other, 123, log, clock)).toBe(0);
    expect(runStrength(root, other, undefined, log, clock)).toBe(0);
    expect(logs.join('\n')).toContain('Strength attempt time');
    expect(runStrength(undefined, root, 123, log)).toBe(2);
    expect(runStrength('/nonexistent-master', root, 123, log)).toBe(2);
    expect(runStrength(root, root, 0, log)).toBe(2);
    let ticks = 0;
    expect(runStrength(root, root, 123, log, () => ticks++ * 13000)).toBe(2);
    expect(logs.join('\n')).toContain('inconclusive');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('CLI accepts a seed and runs without dependencies in the checkouts', () => {
  const root = fixture(true);
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/ai-strength.mjs'), root, '123'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AI strength seed: 123');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('entry point applies CLI seed and generates a seed when omitted', async () => {
  const root = fixture(true), cwd = process.cwd(), argv = process.argv, code = process.exitCode;
  const realNow = performance.now;
  const script = resolve('scripts/ai-strength.mjs');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(root);
    for (const seed of ['123', undefined, 'attempt']) {
      process.argv = [process.execPath, script, root];
      if (seed === 'attempt') process.argv.push('123', '--attempt');
      else if (seed !== undefined) process.argv.push(seed);
      vi.resetModules();
      await import('../scripts/ai-strength.mjs');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('AI strength seed:'));
    }
  } finally {
    performance.now = realNow;
    process.chdir(cwd); process.argv = argv; process.exitCode = code;
    log.mockRestore(); rmSync(root, { recursive: true, force: true });
  }
});

import { runStrengthChecks } from '../scripts/ai-strength.mjs';

test('gives each subprocess its own 14s timeout and retries only strength failures', () => {
  const calls: any[] = [], logs: string[] = [];
  const runner = (...args: any[]) => { calls.push(args); return { status: calls.length === 5 ? 0 : 1, stdout: 'results', stderr: '' }; };
  expect(runStrengthChecks('master', 'candidate', 123, (s: string) => logs.push(s), runner)).toBe(0);
  expect(calls).toHaveLength(5);
  expect(calls.map(c => c[2].timeout)).toEqual(Array(5).fill(14000));
  expect(calls.every(c => c[2].cwd === 'candidate')).toBe(true);
  expect(new Set(calls.map(c => c[1][2])).size).toBe(5);
  expect(calls.every(c => c[1][3] === '--attempt')).toBe(true);
});

test('confirms five failures but immediately reports subprocess errors as inconclusive', () => {
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);
  expect(runStrengthChecks('master', 'candidate', 123, log, () => ({ status: 1, stdout: '', stderr: '' }))).toBe(1);
  expect(logs.join(' ')).toContain('confirmed');
  for (const result of [
    { status: 2, stdout: '', stderr: 'invalid engine' },
    { status: null, signal: 'SIGKILL', stdout: '', stderr: '' },
    { status: null, error: Error('timeout'), stdout: '', stderr: '' },
    { status: null, stdout: '', stderr: '' },
  ]) {
    let calls = 0;
    expect(runStrengthChecks('master', 'candidate', 123, log, () => { calls++; return result; })).toBe(2);
    expect(calls).toBe(1);
  }
  expect(runStrengthChecks(undefined, 'candidate', 123, log)).toBe(2);
  expect(runStrengthChecks('master', 'candidate', 0, log)).toBe(2);
  expect(runStrengthChecks('master', 'candidate', 123, log, () => { throw Error('spawn failed'); })).toBe(2);
});
