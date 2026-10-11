// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { benchmarkPuzzles, loadEngine, runPuzzlePerformance } from '../scripts/puzzle-performance.mjs';

// Deterministic measurements test retry decisions without relying on CPU noise.
function check(scenario: string) {
  const puzzles = ['first', 'second', 'third'].map(id => ({ id }));
  const master = {};
  const candidate = { PUZZLES: puzzles };
  const history: { id: string; master: boolean; puzzle: unknown }[] = [];
  const output: string[] = [];
  const status = benchmarkPuzzles(master, candidate, (line: string) => output.push(line), (engine: unknown, puzzle: { id: string }) => {
    history.push({ id: puzzle.id, master: engine === master, puzzle });
    const attempt = Math.ceil(history.filter(run => run.id === puzzle.id).length / 6);
    const index = puzzles.indexOf(puzzle);
    const fail = scenario === 'persistent' ? index === 1
      : scenario === 'transient' ? index === 1 && attempt === 1
      : scenario === 'fifth' ? index === 1 && attempt < 5
      : scenario === 'mixed' ? attempt <= index : false;
    return engine === master ? 10 : fail ? 20 : 5;
  });
  return { status, history, output: output.join('\n') };
}

test('runs each puzzle three times per version and alternates versions', () => {
  const result = check('pass');
  expect(result.status).toBe(0);
  expect(result.history).toHaveLength(18);
  expect(result.history.map(run => run.master)).toEqual(Array(9).fill([true, false]).flat());
  expect(result.output).not.toContain('repeating');
});

test('retries only the failing puzzle using fresh samples', () => {
  const result = check('transient');
  expect(result.status).toBe(0);
  expect(result.history.map(run => run.id)).toEqual([...Array(6).fill('first'), ...Array(12).fill('second'), ...Array(6).fill('third')]);
  expect(result.output).toContain('repeating');
});

test('accepts a puzzle on its fifth comparison', () => {
  const result = check('fifth');
  expect(result.status).toBe(0);
  expect(result.history.filter(run => run.id === 'second')).toHaveLength(30);
  expect(result.output).toContain('attempt 5/5');
});

test('fails the build after five failed comparisons without running further puzzles', () => {
  const result = check('persistent');
  expect(result.status).toBe(1);
  expect(result.history.filter(run => run.id === 'second')).toHaveLength(30);
  expect(result.history.some(run => run.id === 'third')).toBe(false);
  expect(result.output).toContain('confirmed');
});

test('never reruns a puzzle that passed any comparison', () => {
  const result = check('mixed');
  expect(result.status).toBe(0);
  for (const [id, count] of [['first', 6], ['second', 12], ['third', 18]] as const) {
    const runs = result.history.filter(run => run.id === id);
    expect(runs).toHaveLength(count);
    expect(runs.filter(run => run.master)).toHaveLength(count / 2);
    expect(new Set(runs.map(run => run.puzzle)).size).toBe(1);
  }
});

test('rejects empty or duplicate puzzle lists', () => {
  expect(() => benchmarkPuzzles({}, { PUZZLES: [] })).toThrow('No puzzles');
  expect(() => benchmarkPuzzles({}, { PUZZLES: [{ id: 'x' }, { id: 'x' }] })).toThrow('Duplicate');
});

// A tiny TypeScript engine exercises Node's real loader and CLI without Vitest
// subprocesses, compilation, timing-dependent expectations, or dependencies.
function createFixture(wrongMove = false) {
  const root = mkdtempSync(join(tmpdir(), 'direct-puzzle-performance-'));
  const engine = join(root, 'src/engine');
  mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, 'gogomoku.ts'), `
    export const SOLUTION: number = 0;
    export function decodeGame(encoded: string) { return { toMove: 1, size: 9 }; }
    export function decodeMove(move: string, size: number) { return SOLUTION; }
  `);
  writeFileSync(join(engine, 'ai.ts'), `
    import { SOLUTION } from './gogomoku.ts';
    export class GogoAI {
      findBestMove(position: unknown, timeMs: number) { return { move: ${wrongMove ? 1 : 'SOLUTION'} }; }
    }
  `);
  writeFileSync(join(engine, 'puzzles.ts'), `
    import { SOLUTION } from './gogomoku';
    export const PUZZLES = [{ id: 'example', encoded: 'B9', toMove: 1, solution: 'a1', depth: 3 }];
  `);
  return root;
}

test('loads TypeScript directly, including extensionless and explicit imports', () => {
  const root = createFixture();
  try {
    const engine = loadEngine(root);
    expect(engine.PUZZLES[0].id).toBe('example');
    expect(engine.decodeMove('a1', 9)).toBe(0);
    expect(new engine.GogoAI().findBestMove({}, 100).move).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('configuration errors and incorrect solutions fail immediately', () => {
  const root = createFixture(true);
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  try {
    expect(runPuzzlePerformance(undefined, process.cwd(), log)).toBe(2);
    expect(messages.join(' ')).toContain('Usage:');
    expect(runPuzzlePerformance('/nonexistent-master-checkout', process.cwd(), log)).toBe(2);
    expect(runPuzzlePerformance(root, root, log)).toBe(2);
    expect(messages.join(' ')).toContain('solve');
    expect(messages.join(' ')).not.toContain('repeating');
    expect(() => loadEngine(join(root, 'missing'))).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI runs directly from source without installed dependencies or test files', () => {
  const root = createFixture(true);
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/puzzle-performance.mjs'), root], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('solve');
    expect(result.stderr).not.toContain('vitest');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('entry point uses the working directory and command-line master checkout', async () => {
  const root = createFixture(true);
  const originalCwd = process.cwd();
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const script = resolve('scripts/puzzle-performance.mjs');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(root);
    process.argv = [process.execPath, script, root];
    vi.resetModules();
    await import('../scripts/puzzle-performance.mjs');
    expect(process.exitCode).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('solve'));
  } finally {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    log.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
