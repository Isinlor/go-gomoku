// @vitest-environment node
import { expect, test } from 'vitest';
import { strengthEvidence, benchmarkStrength } from '../scripts/ai-strength.mjs';

test('updates bounded-score loss evidence, with draws neutral', () => {
  let evidence = 1;
  for (let i = 0; i < 5; i++) evidence = strengthEvidence(evidence, -1);
  expect(evidence).toBeLessThan(20);
  expect(strengthEvidence(evidence, -1)).toBeGreaterThan(20);
  expect(strengthEvidence(evidence, 0)).toBe(evidence);
  expect(strengthEvidence(1, 1)).toBeCloseTo(0.2);
  expect(strengthEvidence(1, -0.5)).toBe(1.4);
});

test('passes immediately and retries failures at most five times', async () => {
  const logs: string[] = [];
  let attempts = 0;
  const run = async () => ({ pairs: 8, score: 0, evidence: ++attempts < 3 ? 21 : 1 });
  expect(await benchmarkStrength('master', 'new', (s: string) => logs.push(s), run)).toBe(0);
  expect(attempts).toBe(3);
  expect(logs.join('\n')).toContain('attempt 3/5');
  expect(logs[0]).toContain('candidate 8/16 points');
  attempts = 0;
  expect(await benchmarkStrength('master', 'new', () => {}, async () => {
    attempts++;
    return { pairs: 6, score: 0, evidence: 34 };
  })).toBe(1);
  expect(attempts).toBe(5);
});

import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { vi } from 'vitest';
import * as engine from '../src/engine';
import { loadEngine } from '../scripts/puzzle-performance.mjs';
import {
  createOpening, playStrengthGame, sampleStrength, startStrengthWorker,
  runStrengthIteration, runStrength, MOVE_MS, ITERATION_MS,
} from '../scripts/ai-strength.mjs';

test.each([-2, 2, NaN, Infinity, undefined])('rejects invalid pair scores %s', (score) => {
  expect(() => strengthEvidence(1, score)).toThrow('pair score');
});

test('creates legal varied six-ply openings on a 9x9 board', () => {
  const opening = createOpening(engine);
  const position = engine.decodeGame(opening);
  expect(position.ply).toBe(6);
  expect(position.winner).toBe(0);
  expect(position.size).toBe(9);
  expect(createOpening(engine, () => 0)).not.toBe(createOpening(engine, n => n - 1));
  expect(() => createOpening({ decodeGame: () => ({ isLegal: () => false }) })).toThrow('No legal opening');
  expect(() => createOpening({ decodeGame: () => ({ isLegal: () => true, play: () => false }) })).toThrow('Illegal opening');
});

function sequenceEngine(moves: number[], budgets: number[] = []) {
  return { ...engine, GogoAI: class {
    i = 0;
    findBestMove(_position: unknown, budget: number) {
      budgets.push(budget);
      return { move: moves[this.i++] };
    }
  } };
}

test('plays actual legal games on own-version positions with equal time budgets', () => {
  const budgets: number[] = [];
  const black = sequenceEngine([0, 1, 2, 3, 4], budgets);
  const white = sequenceEngine([9, 18, 27, 36], budgets);
  expect(playStrengthGame(black, white, 'B9', 2)).toBe(-1);
  expect(playStrengthGame(white, black, 'B9', 1)).toBe(1);
  expect(budgets).toHaveLength(18);
  expect(new Set(budgets)).toEqual(new Set([5]));
  expect(MOVE_MS).toBe(5);
  expect(ITERATION_MS).toBeLessThan(15_000);
});

test('draws at the ply cap or when no legal moves remain', () => {
  let moves = 0;
  const capped = {
    decodeGame: () => ({ winner: 0, toMove: 1, hasAnyLegalMove: () => true, isLegal: () => true, play: () => { moves++; return true; } }),
    GogoAI: class { findBestMove() { return { move: 0 }; } },
  };
  expect(playStrengthGame(capped, capped, 'B9', 1)).toBe(0);
  expect(moves).toBe(240);
  const full = { ...capped, decodeGame: () => ({ winner: 0, hasAnyLegalMove: () => false }) };
  expect(playStrengthGame(full, full, 'B9', 2)).toBe(0);
});

test('illegal moves and rule disagreements are errors, not statistical losses', () => {
  expect(() => playStrengthGame(engine, sequenceEngine([-1]), 'B9', 1)).toThrow('illegal move');
  expect(() => playStrengthGame(engine, sequenceEngine([0.5]), 'B9', 1)).toThrow('illegal move');
  const refuses = { ...engine, decodeGame: () => ({ play: () => false }) };
  expect(() => playStrengthGame(engine, refuses, 'B9', 2)).toThrow('rules disagree');
  const disagrees = { ...engine, decodeGame: () => ({ play: () => true, winner: 2 }) };
  expect(() => playStrengthGame(engine, disagrees, 'B9', 2)).toThrow('winners disagree');
});

test.each([0, 1])('swaps colors on identical openings, randomizing pair order (%s)', (coin) => {
  const calls: { opening: string; color: number }[] = [];
  const reports: any[] = [];
  sampleStrength(engine, engine, s => reports.push(s), () => coin, (_m, _c, opening, color) => {
    calls.push({ opening, color });
    return 0;
  });
  expect(reports).toHaveLength(128);
  expect(reports.at(-1)).toEqual({ pairs: 128, score: 0, evidence: 1 });
  for (let i = 0; i < calls.length; i += 2) {
    expect(calls[i].opening).toBe(calls[i + 1].opening);
    expect([calls[i].color, calls[i + 1].color]).toEqual([coin + 1, 2 - coin]);
  }
});

test('reports only complete pairs and stops when loss evidence crosses 20', () => {
  const reports: any[] = [];
  sampleStrength(engine, engine, s => reports.push(s), () => 0, () => -1);
  expect(reports).toHaveLength(7);
  expect(reports.at(-1).score).toBe(-7);
  expect(reports.at(-2).evidence).toBeLessThan(20);
  expect(reports.at(-1).evidence).toBeGreaterThan(20);
  let calls = 0;
  const incomplete: any[] = [];
  expect(() => sampleStrength(engine, engine, s => incomplete.push(s), () => 0, () => {
    if (++calls === 2) throw new Error('interrupted');
    return -1;
  })).toThrow('interrupted');
  expect(incomplete).toHaveLength(0);
});

class TestWorker extends EventEmitter {
  terminations = 0;
  async terminate() { this.terminations++; this.emit('exit', 1); return 1; }
}
async function supervise(events: (worker: TestWorker) => void, ms = 100) {
  const worker = new TestWorker();
  const result = runStrengthIteration('master', 'candidate', (data) => {
    expect(data).toEqual({ masterRoot: 'master', candidateRoot: 'candidate' });
    queueMicrotask(() => events(worker));
    return worker;
  }, ms);
  return { result, worker };
}

test('watchdog discards unfinished work and terminates the worker', async () => {
  const { result, worker } = await supervise(w => w.emit('message', { pairs: 3, score: 0, evidence: 1 }), 1);
  expect(await result).toEqual({ pairs: 3, score: 0, evidence: 1 });
  expect(worker.terminations).toBe(1);
});

test('threshold and clean exit finish early; repeated exit is harmless', async () => {
  for (const evidence of [1, 20]) {
    const { result, worker } = await supervise(w => {
      w.emit('message', { pairs: 6, score: -6, evidence });
      w.emit('exit', 0);
      w.emit('message', { pairs: 99, score: 0, evidence: 0 });
    });
    expect((await result).evidence).toBe(evidence);
    expect(worker.terminations).toBe(1);
  }
});

test('worker errors, bad exits, and empty samples fail immediately', async () => {
  for (const [events, message] of [
    [(w: TestWorker) => w.emit('error', new Error('broken')), 'broken'],
    [(w: TestWorker) => w.emit('exit', 7), 'code 7'],
    [(w: TestWorker) => w.emit('exit', 0), 'No complete'],
    [(_w: TestWorker) => {}, 'No complete'],
  ] as const) {
    const { result } = await supervise(events, 1);
    await expect(result).rejects.toThrow(message);
  }
});

test('accepts fifth attempt and does not retry operational errors', async () => {
  let attempts = 0;
  expect(await benchmarkStrength('m', 'c', undefined, async () => ({ pairs: 6, score: 0, evidence: ++attempts < 5 ? 20 : 1 }))).toBe(0);
  expect(attempts).toBe(5);
  attempts = 0;
  await expect(benchmarkStrength('m', 'c', () => {}, async () => { attempts++; throw new Error('broken'); })).rejects.toThrow('broken');
  expect(attempts).toBe(1);
});

function fixture(aiBody = 'return { move: 0 };') {
  const root = mkdtempSync(join(tmpdir(), 'strength-'));
  const dir = join(root, 'src/engine');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ai.ts'), `export class GogoAI { findBestMove() { ${aiBody} } }`);
  writeFileSync(join(dir, 'gogomoku.ts'), `
    export function decodeGame() { return {
      ply: 0, toMove: 1, winner: 0,
      isLegal: (move) => move >= 0, hasAnyLegalMove: () => true,
      play() { this.ply++; this.toMove = 3 - this.toMove; if(this.ply === 7) this.winner = 1; return true; },
      encodeGame: () => 'B9'
    }; }
    export function decodeMove() { return 0; }
  `);
  writeFileSync(join(dir, 'puzzles.ts'), 'export const PUZZLES = [];');
  return root;
}

test('loads both checkouts without dependencies and sends results', () => {
  const root = fixture();
  const reports: any[] = [];
  try {
    startStrengthWorker({ masterRoot: root, candidateRoot: root }, s => reports.push(s));
    expect(reports).toHaveLength(128);
    const loadCalls: string[] = [];
    startStrengthWorker({ masterRoot: 'm', candidateRoot: 'c' }, () => {}, (path) => { loadCalls.push(path); return loadEngine(root); });
    expect(loadCalls).toEqual(['m', 'c']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real Node worker sends complete iteration results', async () => {
  const root = fixture();
  try {
    expect((await runStrengthIteration(root, root)).pairs).toBe(128);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real Node worker passes the strength benchmark', async () => {
  const root = fixture();
  try {
    expect(await runStrength(root, root, () => {})).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([undefined, '/nonexistent-strength-master'])('invalid master path %s returns exit code 2', async (master) => {
  const root = fixture();
  try {
    expect(await runStrength(master, root, () => {})).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worker search errors return exit code 2', async () => {
  const root = fixture('return { move: -1 };');
  const logs: string[] = [];
  try {
    expect(await runStrength(root, root, s => logs.push(s))).toBe(2);
    expect(logs.join(' ')).toContain('illegal move');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI search errors return exit code 2', () => {
  const root = fixture('return { move: -1 };');
  try {
    const cli = spawnSync(process.execPath, [resolve('scripts/ai-strength.mjs'), root], { cwd: root, encoding: 'utf8' });
    expect(cli.status).toBe(2);
    expect(cli.stdout).toContain('illegal move');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a genuinely stuck search cannot escape the watchdog', async () => {
  const root = fixture('while (true) {}');
  try {
    await expect(runStrengthIteration(root, root, undefined, 100)).rejects.toThrow('No complete');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI entry defaults to cwd and uses the supplied master path', async () => {
  const root = fixture();
  const originalCwd = process.cwd();
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(root);
    process.argv = [process.execPath, resolve(originalCwd, 'scripts/ai-strength.mjs'), root];
    vi.resetModules();
    await import('../scripts/ai-strength.mjs');
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS strength'));
  } finally {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    log.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker entry posts completed pairs to its parent', async () => {
  const root = fixture();
  const reports: any[] = [];
  try {
    vi.doMock('node:worker_threads', async (importOriginal) => ({
      ...await importOriginal<any>(), isMainThread: false,
      workerData: { masterRoot: root, candidateRoot: root },
      parentPort: { postMessage: (s: any) => reports.push(s) },
    }));
    vi.resetModules();
    await import('../scripts/ai-strength.mjs');
    expect(reports).toHaveLength(128);
  } finally {
    vi.doUnmock('node:worker_threads');
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
