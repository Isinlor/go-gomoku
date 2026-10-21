// @vitest-environment node
import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { superviseTimeStrength, sampleTimeStrength, runTimeStrength, timeBudgetEngine, playTimeStrengthGame } from '../scripts/strength-across-time-budgets.mjs';

class Worker extends EventEmitter {
  terminate = vi.fn(async () => 1);
}
const pair = (score: number) => ({ score });

test('fails at the evidence boundary and never retries', async () => {
  const w = new Worker();
  const result = superviseTimeStrength(w);
  for (let i = 0; i < 17; i++) w.emit('message', pair(-1));
  expect(w.terminate).not.toHaveBeenCalled();
  w.emit('message', pair(-1));
  expect(await result).toMatchObject({ status: 'fail', pairs: 18 });
  expect(w.terminate).toHaveBeenCalledTimes(1);
  w.emit('exit', 1);
  w.emit('message', pair(1));
});

test('passes early after three positive pairs', async () => {
  const w = new Worker();
  const result = superviseTimeStrength(w);
  for (let i = 0; i < 3; i++) w.emit('message', pair(1));
  expect(await result).toMatchObject({ status: 'pass', pairs: 3, reason: 'early stop' });
});

test.each([0, 1])('45 second boundary passes only with evidence below one (%s)', async losses => {
  vi.useFakeTimers();
  try {
    const w = new Worker();
    const result = superviseTimeStrength(w);
    w.emit('message', pair(losses ? -1 : 1));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(w.terminate).toHaveBeenCalledTimes(losses ? 0 : 1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toMatchObject({ status: 'pass', reason: losses ? '90s limit' : '45s stop' });
  } finally { vi.useRealTimers(); }
});

test('neutral evidence extends to 90 seconds; unfinished pairs are not scored', async () => {
  vi.useFakeTimers();
  try {
    const w = new Worker();
    const result = superviseTimeStrength(w);
    w.emit('message', pair(0));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(w.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toMatchObject({ pairs: 1, evidence: 1, status: 'pass' });
  } finally { vi.useRealTimers(); }
});

test.each(['error', 'exit', 'message'])('operational %s fails without statistical retries', async event => {
  const w = new Worker();
  const result = superviseTimeStrength(w);
  const rejected = expect(result).rejects.toThrow();
  w.emit(event, event === 'error' ? new Error('broken') : event === 'exit' ? 0 : pair(NaN));
  await rejected;
  expect(w.terminate).toHaveBeenCalledTimes(1);
});

test('a worker producing no observations is an error at the first deadline', async () => {
  vi.useFakeTimers();
  try {
    const w = new Worker();
    const result = superviseTimeStrength(w);
    const rejected = expect(result).rejects.toThrow('No completed opening pairs');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
  } finally { vi.useRealTimers(); }
});

test.each([-2, 2, undefined, Infinity])('rejects invalid pair score %s', score => {
  const w = new Worker();
  const result = superviseTimeStrength(w);
  w.emit('message', { score });
  return expect(result).rejects.toThrow('pair score');
});

test.each([null, {}, { opening: 1 }, { opening: 'B9', highColor: 3 }, { opening: 'B9', highColor: 1 }])('rejects malformed loss records: %j', loss => {
  const w = new Worker();
  const result = superviseTimeStrength(w);
  w.emit('message', { loss });
  return expect(result).rejects.toThrow('Invalid loss record');
});

test('maps each engine to its own budget', () => {
  const engine = { GogoAI: class { findBestMove(p: unknown, ms: number) { return [p, ms]; } } };
  expect(new (timeBudgetEngine(engine, 125).GogoAI)().findBestMove('position', 5)).toEqual(['position', 125]);
});

test.each([0, 1])('samples with replacement and completes swapped-color pairs (%s)', coin => {
  const calls: any[] = [], reports: any[] = [];
  const engine = { GogoAI: class {
    constructor(config: unknown) { expect(config).toEqual({ maxDepth: 30, quiescenceDepth: 4, maxPly: 96 }); }
    findBestMove() {}
  }, decodeGame: (s: string) => s };
  const stop = new Error('stop sampling');
  let games = 0;
  expect(() => sampleTimeStrength(engine, data => {
    reports.push(data);
    if (reports.length === 2) throw stop;
  }, () => coin, (...args: any[]) => { calls.push(args); return ++games % 2 ? -1 : 1; })).toThrow(stop);
  expect(reports).toEqual([{ score: 0 }, { score: 0 }]);
  expect(calls[0][2]).toBe(calls[1][2]);
  expect(calls[0][2]).toBe(calls[2][2]);
  expect(calls.map(c => c[3])).toEqual([coin + 1, 2 - coin, coin + 1, 2 - coin]);
});

test('CLI runner reports statistical failures and passes', async () => {
  for (const score of [-1, 1]) {
    const logs: string[] = [];
    const code = await runTimeStrength('root', s => logs.push(s), () => {
      const w = new Worker();
      queueMicrotask(() => { for (let i = 0; i < 18; i++) w.emit('message', pair(score)); });
      return w;
    });
    expect(code).toBe(score === -1 ? 1 : 0);
    expect(logs.join('\n')).toContain('125ms vs 25ms');
    expect(logs.join('\n')).toContain('/22223');
  }
});

test('CLI runner reports startup and worker errors with exit code two', async () => {
  const logs: string[] = [];
  expect(await runTimeStrength('root', s => logs.push(s), () => { throw new Error('broken'); })).toBe(2);
  expect(logs).toEqual(['ERROR strength-across-time-budgets (125ms vs 25ms): broken']);
});

test('starts both budget comparisons in parallel and waits for both to pass', async () => {
  const workers: Worker[] = [], budgets: unknown[] = [], logs: string[] = [];
  let done = false;
  const result = runTimeStrength('root', text => logs.push(text), (root, comparison) => {
    expect(root).toBe('root');
    budgets.push(comparison);
    const worker = new Worker();
    workers.push(worker);
    return worker;
  }).then(code => { done = true; return code; });
  expect(budgets).toEqual([{ lowMs: 25, highMs: 125 }, { lowMs: 5, highMs: 25 }]);
  for (let i = 0; i < 3; i++) workers[0].emit('message', pair(1));
  await Promise.resolve();
  expect(done).toBe(false);
  for (let i = 0; i < 3; i++) workers[1].emit('message', pair(1));
  expect(await result).toBe(0);
  expect(logs).toHaveLength(2);
  expect(logs[0]).toContain('PASS 125ms vs 25ms');
  expect(logs[1]).toContain('PASS 25ms vs 5ms');
});

test.each([0, 1])('both comparisons share the same elapsed-time limits (pair score: %s)', async score => {
  vi.useFakeTimers();
  try {
    const workers: Worker[] = [];
    let done = false;
    const result = runTimeStrength('root', () => {}, () => {
      const worker = new Worker(); workers.push(worker); return worker;
    }).then(code => { done = true; return code; });
    for (const worker of workers) worker.emit('message', pair(score));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(done).toBe(score === 1);
    if (!done) await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toBe(0);
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test.each(['regression', 'error'])('either comparison can fail and cancels the unfinished peer (%s)', async failure => {
  const workers: Worker[] = [];
  const result = runTimeStrength('root', () => {}, () => {
    const worker = new Worker();
    workers.push(worker);
    return worker;
  });
  expect(workers).toHaveLength(2);
  if (failure === 'error') workers[1].emit('error', new Error('broken'));
  else for (let i = 0; i < 18; i++) workers[1].emit('message', pair(-1));
  expect(await result).toBe(failure === 'error' ? 2 : 1);
  for (const worker of workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test.each([false, true])('an aborted comparison clears its timers and stops its worker (already aborted: %s)', async alreadyAborted => {
  const worker = new Worker(), controller = new AbortController();
  if (alreadyAborted) controller.abort();
  const result = superviseTimeStrength(worker, () => {}, { lowMs: 5, highMs: 25 }, controller.signal);
  controller.abort();
  expect(await result).toMatchObject({ status: 'cancelled', pairs: 0 });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('the sampler applies the selected 25 ms and 5 ms budgets to warmup and games', () => {
  const warmup: number[] = [];
  const engine = { decodeGame: (s: string) => s, GogoAI: class {
    findBestMove(_p: unknown, ms: number) { warmup.push(ms); return ms; }
  } };
  const played: number[] = [];
  expect(() => sampleTimeStrength(engine, () => { throw new Error('sample delivered'); }, () => 0,
    (low, high) => { played.push(new low.GogoAI().findBestMove('B9'), new high.GogoAI().findBestMove('B9')); return 0; },
    { lowMs: 5, highMs: 25 })).toThrow('sample delivered');
  expect(warmup.slice(0, 2)).toEqual([5, 25]);
  expect(played).toEqual([5, 25, 5, 25]);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeGame } from '../src/engine/gogomoku';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'time-strength-'));
  const dir = join(root, 'src/engine');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ai.ts'), 'export class GogoAI { findBestMove(p, ms) { return { move: ms }; } }');
  writeFileSync(join(dir, 'gogomoku.ts'), `
    export function decodeMove() { return 0; }
    export function decodeGame() { return { winner: 0, ply: 0, toMove: 1, hash: 0n,
      hasAnyLegalMove: () => true, isLegal: () => true,
      play(move) {
        this.winner = move === 125 ? this.toMove : move === 5 ? 3 - this.toMove : 0;
        this.toMove = 3 - this.toMove; this.ply++; this.hash = BigInt(this.ply); return true;
      }
    }; }
  `);
  writeFileSync(join(dir, 'puzzles.ts'), 'export const PUZZLES = [];');
  return root;
}

test('CLI entry runs a real worker with its default root and logger', { tags: ['slow'] }, async () => {
  const root = fixture(), cwd = process.cwd(), argv = process.argv, exitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(root);
    process.argv = [process.execPath, resolve(cwd, 'scripts/strength-across-time-budgets.mjs')];
    vi.resetModules();
    await import('../scripts/strength-across-time-budgets.mjs');
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS 125ms vs 25ms: 3 opening pairs'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS 25ms vs 5ms: 3 opening pairs'));
  } finally {
    process.chdir(cwd); process.argv = argv; process.exitCode = exitCode;
    log.mockRestore(); vi.resetModules(); rmSync(root, { recursive: true, force: true });
  }
});

test('worker entry loads the engine and reports completed pairs', async () => {
  const root = fixture();
  const send = vi.fn(() => { throw new Error('sample delivered'); });
  try {
    vi.doMock('node:worker_threads', async original => ({
      ...await original<any>(), isMainThread: false,
      workerData: { root }, parentPort: { postMessage: send },
    }));
    vi.resetModules();
    await expect(import('../scripts/strength-across-time-budgets.mjs')).rejects.toThrow('sample delivered');
    expect(send).toHaveBeenCalledWith({ score: 1 });
  } finally {
    vi.doUnmock('node:worker_threads'); vi.resetModules(); rmSync(root, { recursive: true, force: true });
  }
});

test.each([1, 2])('plays budget-specific engines and reports the high-budget winner (%s)', color => {
  const calls: number[] = [];
  const engine = { decodeGame: () => ({ winner: 0, ply: 0, toMove: 1, hash: 0n,
    hasAnyLegalMove: () => true, isLegal: () => true,
    play(this: any) { this.winner = 1; this.ply++; }, encodeGame: () => 'B9 a1' }),
    GogoAI: class { findBestMove() { calls.push(1); return { move: 0 }; } } };
  expect(playTimeStrengthGame(engine, engine, 'B9', color)).toBe(color === 1 ? 1 : -1);
  expect(calls).toEqual([1]);
});

test('a higher-budget loss includes the opening, its color, and a complete replayable game', () => {
  const engine = { decodeGame, GogoAI: class {
    findBestMove(position: ReturnType<typeof decodeGame>) {
      return { move: position.toMove === 1 ? Math.floor(position.ply / 2) : 9 * (1 + Math.floor(position.ply / 2)) };
    }
  } };
  const losses: any[] = [];
  expect(playTimeStrengthGame(engine, engine, 'B9 a1 a2 b1', 2, loss => losses.push(loss))).toBe(-1);
  expect(losses).toEqual([{ opening: 'B9 a1 a2 b1', highColor: 2, record: 'B9 a1 a2 b1 a3 c1 a4 d1 a5 e1' }]);
  expect(decodeGame(losses[0].record).winner).toBe(1);
});

test('a completed loss is delivered before the next game or its pair can be interrupted', () => {
  const engine = { GogoAI: class { findBestMove() {} }, decodeGame: (s: string) => s };
  const reports: any[] = [];
  let games = 0;
  expect(() => sampleTimeStrength(engine, data => reports.push(data), () => 0, (_l, _h, opening, highColor, reportLoss) => {
    if (++games === 2) throw new Error('interrupted');
    reportLoss({ opening, highColor, record: `${opening} a1` });
    return -1;
  })).toThrow('interrupted');
  expect(reports).toEqual([{ loss: { opening: expect.any(String), highColor: 1, record: expect.any(String) } }]);
});

test('loss histories from an unfinished pair are logged without becoming statistical samples', async () => {
  vi.useFakeTimers();
  try {
    const w = new Worker(), logs: string[] = [];
    const result = superviseTimeStrength(w, text => logs.push(text));
    const rejected = expect(result).rejects.toThrow('No completed opening pairs');
    w.emit('message', { loss: { opening: 'B9', highColor: 2, record: 'B9 a1' } });
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(logs).toEqual(['125ms lost game vs. 25ms: {"opening":"B9","highColor":2,"record":"B9 a1"}']);
  } finally { vi.useRealTimers(); }
});

test('loss histories queued while the worker terminates are still logged', async () => {
  const w = new Worker(), logs: string[] = [];
  const result = superviseTimeStrength(w, text => logs.push(text));
  for (let i = 0; i < 3; i++) w.emit('message', pair(1));
  w.emit('message', { loss: { opening: 'B9', highColor: 2, record: 'B9 a1' } });
  expect(await result).toMatchObject({ pairs: 3, status: 'pass' });
  expect(logs).toHaveLength(1);
});

test.each(['pass', 'fail', 'error'])('CLI always prints every loss history, including before %s', async status => {
  const logs: string[] = [];
  const losses = [
    { opening: 'B9 a1', highColor: 1, record: 'B9 a1 a2 b1 b2 c1 c2 d1 d2 a3 e2' },
    { opening: 'B9 b1', highColor: 2, record: 'B9 b1 a2 c1 b2 d1 c2 e1 d2 f1' },
  ];
  const code = await runTimeStrength('root', text => logs.push(text), () => {
    const w = new Worker();
    queueMicrotask(() => {
      for (const loss of losses) w.emit('message', { loss });
      if (status === 'error') w.emit('error', new Error('broken'));
      else for (let i = 0; i < 18; i++) w.emit('message', pair(status === 'pass' ? 1 : -1));
    });
    return w;
  });
  expect(code).toBe(status === 'pass' ? 0 : status === 'fail' ? 1 : 2);
  expect(logs.slice(0, 2)).toEqual(losses.map(loss => `125ms lost game vs. 25ms: ${JSON.stringify(loss)}`));
});

test('25 ms losses are labelled with their actual 5 ms opponent', async () => {
  const worker = new Worker(), logs: string[] = [];
  const result = superviseTimeStrength(worker, text => logs.push(text), { lowMs: 5, highMs: 25 });
  worker.emit('message', { loss: { opening: 'B9', highColor: 2, record: 'B9 a1' } });
  for (let i = 0; i < 3; i++) worker.emit('message', pair(1));
  expect(await result).toMatchObject({ status: 'pass' });
  expect(logs).toEqual(['25ms lost game vs. 5ms: {"opening":"B9","highColor":2,"record":"B9 a1"}']);
});

test('each timed move uses the deployed search config and a fresh AI, as the UI worker does', () => {
  const options: unknown[] = [];
  const engine = {
    decodeGame: () => ({ winner: 0, ply: 0, toMove: 1,
      get hash() { return BigInt(this.ply); },
      hasAnyLegalMove: () => true, isLegal: () => true,
      play(this: any) { this.ply++; this.toMove = 3 - this.toMove; if (this.ply === 4) this.winner = 1; },
    }),
    GogoAI: class {
      used = false;
      constructor(config: unknown) { options.push(config); }
      findBestMove() {
        expect(this.used).toBe(false);
        this.used = true;
        return { move: 0 };
      }
    },
  };
  expect(playTimeStrengthGame(timeBudgetEngine(engine, 25), timeBudgetEngine(engine, 125), 'B9', 1)).toBe(1);
  expect(options).toEqual(Array(4).fill({ maxDepth: 30, quiescenceDepth: 4, maxPly: 96 }));
});

test.each(['repeat', 'full', 'limit', 'illegal'])('handles game termination: %s', mode => {
  const engine = { decodeGame: () => ({ winner: 0, ply: mode === 'limit' ? 100 : 0, toMove: 1, hash: 0n,
    hasAnyLegalMove: () => mode !== 'full', isLegal: () => mode !== 'illegal', play() {} }),
    GogoAI: class { findBestMove() { return { move: 0 }; } } };
  if (mode === 'illegal') expect(() => playTimeStrengthGame(engine, engine, 'B9', 1)).toThrow('illegal move');
  else expect(playTimeStrengthGame(engine, engine, 'B9', 1)).toBe(0);
});
