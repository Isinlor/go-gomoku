// @vitest-environment node
import { beforeAll, expect, test } from 'vitest';
import { stripTypeScriptTypes } from 'node:module';
import { strengthEvidence, benchmarkStrength, evaluateOpenings, parseStrengthArgs } from '../scripts/ai-strength.mjs';

// Initialize Node's native compiler once; each integration still loads fresh files.
beforeAll(() => { stripTypeScriptTypes('const warmup: number = 0;'); });

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

test.each([19.999, 20, 20.001])('loss evidence fails at and above the threshold: %s', async evidence => {
  let attempts = 0;
  expect(await benchmarkStrength('master', 'new', () => {}, async () => {
    attempts += 1;
    return { pairs: 6, score: 0, evidence };
  })).toBe(evidence < 20 ? 0 : 1);
  expect(attempts).toBe(evidence < 20 ? 1 : 5);
});

import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { vi } from 'vitest';
import * as engine from '../src/engine';
import { loadEngine } from '../scripts/puzzle-performance.mjs';
import {
  playStrengthGame, sampleStrength, startStrengthWorker,
  runStrengthIteration, runStrength, MOVE_MS,
} from '../scripts/ai-strength.mjs';

test.each([-2, 2, NaN, Infinity, undefined])('rejects invalid pair scores %s', (score) => {
  expect(() => strengthEvidence(1, score)).toThrow('pair score');
});

test('uses the supplied balanced opening pool and preserves its provenance', () => {
  const pool = JSON.parse(readFileSync(new URL('../scripts/strength-openings.json', import.meta.url), 'utf8'));
  expect(pool.masterRevision).toBe('4c9b1078a3b46e9e10dd0b338aee484a02372581');
  expect(pool.boards).toHaveLength(100);
  expect(new Set(pool.boards.map((board: any) => board.encoded)).size).toBe(100);
  for (const winner of [1, 2]) {
    expect(pool.boards.filter((board: any) => board.playout.winner === winner)).toHaveLength(50);
  }
  for (let index = 0; index < pool.boards.length; index++) {
    const opening = pool.boards[index].encoded;
    const position = engine.decodeGame(opening);
    expect(position.size).toBe(9);
    expect(position.ply).toBe(3);
    expect(position.winner).toBe(0);
  }
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
});

test.each([99, 100, 101])('caps games at 100 total plies, including the opening (win at %s)', winPly => {
  let moves = 0;
  const long = {
    decodeGame: () => ({ winner: 0, toMove: 1, ply: 3, get hash() { return BigInt(this.ply); },
      hasAnyLegalMove: () => true, isLegal: () => true,
      play() { moves++; this.ply++; if (this.ply === winPly) this.winner = 1; return true; } }),
    GogoAI: class { findBestMove() { return { move: 0 }; } },
  };
  expect(playStrengthGame(long, long, 'B9 e5 d5 c5', 1)).toBe(winPly <= 100 ? 1 : 0);
  expect(moves).toBe(2 * (Math.min(winPly, 100) - 3));
});

test('draws on repetition or no legal moves before the ply limit', () => {
  const repeated = { decodeGame: () => ({ winner: 0, toMove: 1, ply: 3, hash: 0n,
    hasAnyLegalMove: () => true, isLegal: () => true, play: () => true }),
    GogoAI: class { findBestMove() { return { move: 0 }; } } };
  expect(playStrengthGame(repeated, repeated, 'B9', 1)).toBe(0);
  const full = { ...repeated, decodeGame: () => ({ winner: 0, ply: 3, hasAnyLegalMove: () => false }) };
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
    return -1;
  });
  expect(reports).toHaveLength(100);
  expect(reports.at(-1).score).toBe(-100);
  for (let i = 0; i < calls.length; i += 2) {
    expect(calls[i].opening).toBe(calls[i + 1].opening);
    expect([calls[i].color, calls[i + 1].color]).toEqual([coin + 1, 2 - coin]);
  }
});

test('plays every opening exactly once despite early loss evidence, reporting complete pairs', () => {
  const reports: any[] = [];
  sampleStrength(engine, engine, s => reports.push(s), () => 0, () => -1);
  expect(reports).toHaveLength(100);
  expect(reports.at(-1).score).toBe(-100);
  expect(reports[5].evidence).toBeLessThan(20);
  expect(reports[6].evidence).toBeGreaterThan(20);
  expect(reports.at(-1).evidence).toBeGreaterThan(20);
  const played: string[] = [];
  sampleStrength(engine, engine, () => {}, () => 0, (_m, _c, opening) => { played.push(opening); return 0; });
  const pool = JSON.parse(readFileSync(new URL('../scripts/strength-openings.json', import.meta.url), 'utf8'));
  expect([...new Set(played)].sort()).toEqual(pool.boards.map((b: any) => b.encoded).sort());
  expect(played).toHaveLength(200);
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
async function supervise(events: (worker: TestWorker) => void) {
  const worker = new TestWorker();
  const result = runStrengthIteration('master', 'candidate', (data) => {
    expect(data).toEqual({ masterRoot: 'master', candidateRoot: 'candidate', timeMs: 5 });
    queueMicrotask(() => events(worker));
    return worker;
  });
  return { result, worker };
}

test('waits for worker completion beyond the former deadline and evidence threshold', async () => {
  vi.useFakeTimers();
  try {
    const worker = new TestWorker();
    let settled = false;
    const result = runStrengthIteration('m', 'c', () => worker).then(value => { settled = true; return value; });
    worker.emit('message', { pairs: 7, score: -7, evidence: 30 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(worker.terminations).toBe(0);
    worker.emit('message', { pairs: 100, score: -10, evidence: 40 });
    worker.emit('exit', 0);
    expect(await result).toEqual({ pairs: 100, score: -10, evidence: 40 });
  } finally { vi.useRealTimers(); }
});

test('clean exit finishes the iteration; repeated exit is harmless', async () => {
  for (const evidence of [1, 20]) {
    const { result, worker } = await supervise(w => {
      w.emit('message', { pairs: 100, score: -6, evidence });
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
    [(w: TestWorker) => w.emit('exit', 0), 'Incomplete strength iteration'],
  ] as const) {
    const { result } = await supervise(events);
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

function fixture(aiBody = 'return { move: 0, score: 0 };') {
  const root = mkdtempSync(join(tmpdir(), 'strength-'));
  const dir = join(root, 'src/engine');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ai.ts'), `export class GogoAI { findBestMove() { ${aiBody} } }`);
  writeFileSync(join(dir, 'gogomoku.ts'), `
    export function decodeGame() { return {
      ply: 0, toMove: 1, winner: 0, get hash() { return BigInt(this.ply); },
      isLegal: (move) => move >= 0, hasAnyLegalMove: () => true,
      play() { this.ply++; this.toMove = 3 - this.toMove; if(this.ply === 7) this.winner = 1; return true; },
      encodeGame: () => 'B9'
    }; }
    export function decodeMove() { return 0; }
  `);
  writeFileSync(join(dir, 'puzzles.ts'), 'export const PUZZLES = [];');
  return root;
}

test('loads both checkouts without dependencies and sends results', { tags: ['slow'] }, () => {
  const root = fixture();
  const reports: any[] = [];
  try {
    startStrengthWorker({ masterRoot: root, candidateRoot: root }, s => reports.push(s));
    expect(reports).toHaveLength(100);
    const loadCalls: string[] = [];
    startStrengthWorker({ masterRoot: 'm', candidateRoot: 'c' }, () => {}, (path) => { loadCalls.push(path); return loadEngine(root); });
    expect(loadCalls).toEqual(['m', 'c']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Real worker/process integrations need headroom for CI startup and scheduling.
test('real Node worker sends complete iteration results', { tags: ['slow'] }, async () => {
  const root = fixture();
  try {
    expect((await runStrengthIteration(root, root)).pairs).toBe(100);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real Node worker passes the strength benchmark', { tags: ['slow'] }, async () => {
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

test('worker search errors return exit code 2', { tags: ['slow'] }, async () => {
  const root = fixture('return { move: -1 };');
  const logs: string[] = [];
  try {
    expect(await runStrength(root, root, s => logs.push(s))).toBe(2);
    expect(logs.join(' ')).toContain('illegal move');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI search errors return exit code 2', { tags: ['slow'] }, () => {
  const root = fixture('return { move: -1 };');
  try {
    const cli = spawnSync(process.execPath, [resolve('scripts/ai-strength.mjs'), root], { cwd: root, encoding: 'utf8' });
    expect(cli.status).toBe(2);
    expect(cli.stdout).toContain('illegal move');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI entry defaults to cwd and uses the supplied master path', { tags: ['slow'] }, async () => {
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
    expect(reports).toHaveLength(100);
  } finally {
    vi.doUnmock('node:worker_threads');
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});


test('interleaves evaluations and counts all six comparative diagnostics', () => {
  const calls: string[] = [];
  const makeEngine = (name: string, moves: number[], scores: number[]) => ({
    decodeGame: (encoded: string) => Number(encoded), GogoAI: class {
      findBestMove(index: number, budget: number) {
        expect(budget).toBe(5);
        calls.push(`${name}${index}`);
        return { move: moves[index], score: scores[index] };
      }
    }
  });
  const boards = [0, 1, 2, 3].map(index => ({ encoded: String(index), strongest: { move: 3 },
    scores: { 100: -1 }, screening: { strongest: { move: 3 }, score: 1 } }));
  const stats = evaluateOpenings(makeEngine('m', [3, 4, 3, 4], [-1, 0, 1, -1]),
    makeEngine('c', [3, 3, 4, 5], [-1, -1, 1, 1]), boards);
  expect(calls).toEqual(['m0', 'c0', 'c1', 'm1', 'm2', 'c2', 'c3', 'm3']);
  expect(stats.master).toEqual({ total: 4, signs: { negative: 2, zero: 1, positive: 1 },
    references: { '100ms': { moves: 2, signs: 2 }, '10s': { moves: 2, signs: 1 } } });
  expect(stats.candidate).toEqual({ total: 4, signs: { negative: 2, zero: 0, positive: 2 },
    references: { '100ms': { moves: 2, signs: 2 }, '10s': { moves: 2, signs: 2 } } });
  expect(stats.diagnostics).toEqual({
    'Master–candidate exact move agreement': 1,
    'Master–candidate evaluation-sign agreement': 2,
    'Candidate alone matches the 10 s move': 1,
    'Master alone matches the 10 s move': 1,
    'Both match the 10 s move': 1,
    'Neither matches the 10 s move': 1,
  });
});

test('tracks symmetric gain evidence and reports significant gains without failing', async () => {
  const reports: any[] = [];
  sampleStrength(engine, engine, s => reports.push(s), () => 0, () => 1);
  expect(reports.at(-1).gainEvidence).toBeGreaterThan(100);
  expect(reports.at(-1).evidence).toBeLessThan(1);
  const logs: string[] = [];
  const statistics = { total: 2, signs: { negative: 1, zero: 0, positive: 1 }, references: { '100ms': { moves: 1, signs: 2 }, '10s': { moves: 2, signs: 1 } } };
  expect(await benchmarkStrength('m', 'c', s => logs.push(s), async () => ({ pairs: 10, score: 10, evidence: 0.1, gainEvidence: 100, openingStats: { master: statistics, candidate: statistics, diagnostics: { 'Both match the 10 s move': 1 } } }))).toBe(0);
  expect(logs.join('\n')).toContain('Strength increase detected');
  expect(logs.join('\n')).toContain('candidate vs 100ms: moves 1/2 (50.0%), eval signs 2/2 (100.0%)');
  expect(logs.join('\n')).toContain('negative 1, zero 0, positive 1');
  expect(logs.join('\n')).toContain('Both match the 10 s move: 1/2 (50.0%)');
});


test.each([99.999, 100, 100.001])('gain evidence reports at the threshold: %s', async gainEvidence => {
  const logs: string[] = [];
  expect(await benchmarkStrength('m', 'c', s => logs.push(s), async () => ({ pairs: 10, score: 4, evidence: 1, gainEvidence }))).toBe(0);
  expect(logs.some(s => s.includes('Strength increase detected'))).toBe(gainEvidence >= 100);
});


test.each([1, 99, 101, undefined])('rejects a clean worker exit with an invalid pair count: %s', async pairs => {
  const { result } = await supervise(w => {
    w.emit('message', { pairs, score: 0, evidence: 1 });
    w.emit('exit', 0);
  });
  await expect(result).rejects.toThrow('Incomplete strength iteration: expected 100 pairs');
});

test('custom move budget reaches game searches, evaluations, warmup, and workers', async () => {
  const budgets: number[] = [];
  const black = sequenceEngine([0, 1, 2, 3, 4], budgets);
  const white = sequenceEngine([9, 18, 27, 36], budgets);
  expect(playStrengthGame(black, white, 'B9', 2, 25)).toBe(-1);
  expect(new Set(budgets)).toEqual(new Set([25]));
  const boards = [{ encoded: 'B9', strongest: { move: 0 }, scores: { 100: 0 }, screening: { strongest: { move: 0 }, score: 0 } }];
  evaluateOpenings(sequenceEngine([0], budgets), sequenceEngine([0], budgets), boards, 25);
  const calls: number[] = [];
  sampleStrength(black, white, () => {}, () => 0, (_m, _c, _o, _color, timeMs) => { calls.push(timeMs); return 0; }, 25);
  expect(new Set(calls)).toEqual(new Set([25]));
  const worker = new TestWorker();
  const result = runStrengthIteration('m', 'c', data => {
    expect(data.timeMs).toBe(25);
    queueMicrotask(() => { worker.emit('message', { pairs: 100 }); worker.emit('exit', 0); });
    return worker;
  }, 25);
  await result;
});


test('CLI time budget defaults to 5 ms and accepts an explicit budget in either order', () => {
  expect(parseStrengthArgs(['master'])).toEqual({ masterRoot: 'master', timeMs: 5, alpha: .05 });
  expect(parseStrengthArgs(['master', '--time-ms', '25'])).toEqual({ masterRoot: 'master', timeMs: 25, alpha: .05 });
  expect(parseStrengthArgs(['--time-ms', '2.5', 'master'])).toEqual({ masterRoot: 'master', timeMs: 2.5, alpha: .05 });
  expect(parseStrengthArgs([])).toEqual({ masterRoot: undefined, timeMs: 5, alpha: .05 });
});

test.each([['--time-ms'], ['--time-ms', '0'], ['--time-ms', '-1'], ['--time-ms', 'NaN'], ['--time-ms', 'Infinity'], ['--unknown'], ['m', 'c']].map(args => [args]))('rejects malformed CLI arguments %s', args => {
  expect(() => parseStrengthArgs(args)).toThrow();
});

test('CLI alpha defaults to .05 and accepts the requested .01', () => {
  expect(parseStrengthArgs(['master']).alpha).toBe(.05);
  expect(parseStrengthArgs(['master', '--alpha', '.01']).alpha).toBe(.01);
});

test.each(['0', '1', '-.1', 'NaN', 'Infinity', undefined])('rejects invalid alpha %s', alpha => {
  expect(() => parseStrengthArgs(['master', '--alpha', alpha])).toThrow('alpha');
});

test('gain detection uses the configured alpha across five attempts', async () => {
  const logs: string[] = [];
  const run = async () => ({ pairs: 100, score: 30, evidence: 1, gainEvidence: 200 });
  await benchmarkStrength('m', 'c', s => logs.push(s), run, 25, .01);
  expect(logs.join('\n')).not.toContain('Strength increase detected');
  await benchmarkStrength('m', 'c', s => logs.push(s), async () => ({ ...await run(), gainEvidence: 501 }), 25, .01);
  expect(logs.join('\n')).toContain('one-sided 1%');
});

test('CLI malformed options return exit code 2', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.argv = [process.execPath, resolve('scripts/ai-strength.mjs'), '--alpha', '0'];
    vi.resetModules();
    await import('../scripts/ai-strength.mjs');
    expect(process.exitCode).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('alpha'));
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    log.mockRestore();
    vi.resetModules();
  }
});

test.each([-1, 0, 1])('reports separate wins, draws, and losses for outcome %s', outcome => {
  const reports: any[] = [];
  sampleStrength(engine, engine, s => reports.push(s), () => 0, () => outcome);
  expect(reports.at(-1).outcomes).toEqual({ wins: outcome === 1 ? 200 : 0, draws: outcome === 0 ? 200 : 0, losses: outcome === -1 ? 200 : 0 });
});
