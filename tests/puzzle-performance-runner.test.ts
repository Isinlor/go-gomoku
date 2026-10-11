// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { runPuzzlePerformance } from '../scripts/puzzle-performance.mjs';

// A lightweight reporter fixture exercises the actual Node orchestration and
// comparator without spending minutes solving puzzles in every unit test run.
function createFixture(scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'puzzle-performance-'));
  writeFileSync(join(root, 'scenario'), scenario);
  mkdirSync(join(root, 'master'));
  mkdirSync(join(root, 'node_modules/vitest'), { recursive: true });
  writeFileSync(join(root, 'node_modules/vitest/vitest.mjs'), `
      import { readFileSync, writeFileSync, existsSync } from 'node:fs';
      const countFile = 'count';
      const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) + 1 : 1;
      writeFileSync(countFile, String(count));
      const scenario = readFileSync('scenario', 'utf8');
      if (scenario === 'solver-error') process.exit(3);
      const master = process.argv[process.argv.indexOf('--root') + 1].endsWith('/master');
      const pattern = new RegExp(process.argv[process.argv.indexOf('--testNamePattern') + 1]);
      const names = ['Classic AI solves puzzle example', 'Classic AI solves generated puzzle retry.two+[1]', 'Classic AI solves puzzle retry-three'];
      const history = existsSync('history') ? JSON.parse(readFileSync('history', 'utf8')) : [];
      const assertionResults = names.map((fullName, index) => {
        if (!pattern.test(fullName)) return { fullName, status: 'skipped' };
        history.push({ fullName, master });
        const attempt = Math.ceil(history.filter(r => r.fullName === fullName).length / 6);
        const fails = scenario === 'persistent' ? index === 1
          : scenario === 'transient' ? index === 1 && attempt === 1
          : scenario === 'fifth-attempt' ? index === 1 && attempt < 5
          : scenario === 'mixed' ? attempt <= index : false;
        return { fullName, status: 'passed', duration: master ? 10 : fails ? 20 : 5 };
      });
      writeFileSync('history', JSON.stringify(history));
      const report = { success: scenario !== 'invalid', testResults: [{ assertionResults }] };
      const output = process.argv.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
      writeFileSync('report-path', output);
      writeFileSync(output, scenario === 'bad-json' ? 'invalid JSON' : JSON.stringify(report));
  `);
  return root;
}

function check(scenario: string) {
  const root = createFixture(scenario);
  try {
    const output: string[] = [];
    const status = runPuzzlePerformance(join(root, 'master'), root, (line: string) => output.push(line));
    const reportPath = join(root, 'report-path');
    if (existsSync(reportPath)) expect(existsSync(readFileSync(reportPath, 'utf8'))).toBe(false);
    return {
      status, output: output.join('\n'), runs: Number(readFileSync(join(root, 'count'), 'utf8')),
      history: existsSync(join(root, 'history')) ? JSON.parse(readFileSync(join(root, 'history'), 'utf8')) : [],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('runs exactly three times per version when timings pass', () => {
  const result = check('pass');
  expect(result.status).toBe(0);
  expect(result.runs).toBe(6);
  expect(result.output).not.toContain('repeating');
});

test('retries using six fresh samples and accepts a transient regression', () => {
  const result = check('transient');
  expect(result.status).toBe(0);
  expect(result.runs).toBe(12);
  expect(result.output).toContain('repeating');
});

test('fails after five failed comparisons without retrying indefinitely', () => {
  const result = check('persistent');
  expect(result.status).toBe(1);
  expect(result.runs).toBe(30);
  expect(result.output).toContain('confirmed after five attempts');
  expect(result.output).toContain('attempt 5/5');
});

test('invalid reports and solver errors fail without retrying', () => {
  expect(check('invalid')).toMatchObject({ status: 2, runs: 6 });
  expect(check('solver-error')).toMatchObject({ status: 2, runs: 1 });
});


test('accepts a puzzle that passes on its fifth comparison', () => {
  const result = check('fifth-attempt');
  expect(result.status).toBe(0);
  expect(result.runs).toBe(30);
  const retryRuns = result.history.filter((run: { fullName: string }) => run.fullName.includes('retry.two'));
  expect(retryRuns).toHaveLength(30);
  expect(result.output).toContain('attempt 5/5');
});

test('never reruns a validated puzzle, even while other puzzles need two or three attempts', () => {
  const result = check('mixed');
  expect(result.status).toBe(0);
  expect(result.runs).toBe(18);
  const counts = new Map<string, number>();
  for (const run of result.history) counts.set(run.fullName, (counts.get(run.fullName) ?? 0) + 1);
  expect([...counts.values()]).toEqual([6, 12, 18]);
  for (const [name, count] of counts) {
    expect(result.history.filter((run: { fullName: string; master: boolean }) => run.fullName === name && run.master)).toHaveLength(count / 2);
  }
});


test('malformed JSON fails immediately and removes temporary reports', () => {
  expect(check('bad-json')).toMatchObject({ status: 2, runs: 1 });
});

test('missing arguments and nonexistent checkouts return a usage or configuration error', () => {
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  expect(runPuzzlePerformance(undefined, process.cwd(), log)).toBe(2);
  expect(messages.join(' ')).toContain('Usage:');
  expect(runPuzzlePerformance('/nonexistent-master-checkout', process.cwd(), log)).toBe(2);
});

test('the Node CLI runs the same orchestration', () => {
  const root = createFixture('pass');
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/puzzle-performance.mjs'), join(root, 'master')], {
      cwd: root, encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(Number(readFileSync(join(root, 'count'), 'utf8'))).toBe(6);
    expect(result.stdout).toContain('PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the entry point uses the working directory and command-line master checkout', async () => {
  const root = createFixture('pass');
  const originalCwd = process.cwd();
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const script = resolve('scripts/puzzle-performance.mjs');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(root);
    process.argv = [process.execPath, script, join(root, 'master')];
    vi.resetModules();
    await import('../scripts/puzzle-performance.mjs');
    expect(process.exitCode).toBe(0);
    expect(Number(readFileSync(join(root, 'count'), 'utf8'))).toBe(6);
  } finally {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    log.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
