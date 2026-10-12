// @vitest-environment node
import { expect, test } from 'vitest';
import { comparePairs } from '../scripts/ai-strength.mjs';

test('uses the exact one-sided binomial tail, ignoring tied pairs', () => {
  expect(comparePairs([-1, -1, -1, -1])).toEqual({ wins: 0, losses: 4, ties: 0, p: 0.0625, passed: true });
  expect(comparePairs([-1, -1, -1, -1, -1]).passed).toBe(false);
  expect(comparePairs([-1, -1, -1, -1, -1, -1, -1, 1]).p).toBe(9 / 256);
  expect(comparePairs([0, 0])).toEqual({ wins: 0, losses: 0, ties: 2, p: 1, passed: true });
  expect(comparePairs([1, 1]).passed).toBe(true);
});

test('rejects invalid pair outcomes', () => {
  expect(() => comparePairs([2])).toThrow('outcome');
});

import * as engine from '../src/engine';
import { benchmarkStrength, makeOpening, playGame, seededRandom, runStrength, MAX_PLIES, PAIRS } from '../scripts/ai-strength.mjs';
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
  for (const seed of [0, -1, NaN, 1.5, 0x100000000]) expect(() => seededRandom(seed)).toThrow('Seed');
});

test('discards an opening move that wins and rejects malformed opening rules', () => {
  const remaining = Array.from({ length: 25 }, (_, i) => (2 + Math.floor(i / 5)) * 9 + 2 + i % 5);
  const targets = [20, 56, 21, 57, 22, 58, 23, 59, 24];
  let calls = 0;
  const opening = makeOpening(engine, () => {
    if (calls++ === 0) return 8;
    const index = remaining.indexOf(targets.shift()!);
    remaining.splice(index, 1);
    return index;
  }, 9);
  expect(engine.decodeGame(opening).winner).toBe(0);
  expect(engine.decodeGame(opening).ply).toBe(8);
  expect(() => makeOpening({ decodeGame: () => ({ isLegal: () => false }) }, () => 0, 9)).toThrow('No legal');
  expect(() => makeOpening({ decodeGame: () => ({ isLegal: () => true, play: () => false }) }, () => 0, 9)).toThrow('Illegal opening');
});

function tournament(failures: number) {
  const history: unknown[][] = [], logs: string[] = [];
  const status = benchmarkStrength(engine, engine, 123, (s: string) => logs.push(s), check,
    (...args: unknown[]) => { history.push(args); return history.length <= failures * PAIRS * 2 ? -1 : 0; });
  return { status, history, logs: logs.join('\n') };
}

test('passes ties, swaps colors, shares openings and retries only failed batches', () => {
  const pass = tournament(0);
  expect(pass.status).toBe(0);
  expect(pass.history).toHaveLength(PAIRS * 2);
  for (let i = 0; i < PAIRS * 2; i += 2) {
    expect(pass.history[i][2]).toBe(pass.history[i + 1][2]);
    expect(Number(pass.history[i][3]) + Number(pass.history[i + 1][3])).toBe(3);
  }
  const retry = tournament(1);
  expect(retry.status).toBe(0);
  expect(retry.history).toHaveLength(PAIRS * 4);
  expect(retry.logs).toContain('fresh openings');
  expect(retry.history[0][2]).not.toBe(retry.history[PAIRS * 2][2]);
  expect(tournament(4).status).toBe(0);
  const fail = tournament(5);
  expect(fail.status).toBe(1);
  expect(fail.history).toHaveLength(PAIRS * 10);
  expect(fail.logs).toContain('confirmed');
  const singleLogs: string[] = [];
  expect(benchmarkStrength(engine, engine, 123, (s: string) => singleLogs.push(s), check, () => -1, 1)).toBe(1);
  expect(singleLogs.join(' ')).toContain('Possible strength regression in this attempt');
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
  expect(options).toEqual(Array(4).fill({ maxDepth: 10, quiescenceDepth: 4 }));
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

function fixture() {
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
  writeFileSync(join(dir, 'ai.ts'), 'export class GogoAI { findBestMove() { return { move: -1 }; } }');
  writeFileSync(join(dir, 'puzzles.ts'), 'export const PUZZLES = [];');
  return root;
}

test('runner loads separate checkouts, prints timings, and returns errors without retrying', () => {
  const root = fixture(), other = fixture(), logs: string[] = [];
  const log = (s: string) => logs.push(s);
  try {
    expect(runStrength(root, other, 123, log)).toBe(0);
    expect(runStrength(root, other, undefined, log)).toBe(0);
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
  const root = fixture();
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/ai-strength.mjs'), root, '123'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AI strength seed: 123');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('entry point applies CLI seed and generates a seed when omitted', async () => {
  const root = fixture(), cwd = process.cwd(), argv = process.argv, code = process.exitCode;
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
