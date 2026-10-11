// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

// A lightweight reporter fixture exercises the actual shell orchestration and
// comparator without spending minutes solving puzzles in every unit test run.
function check(scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'puzzle-performance-'));
  try {
    mkdirSync(join(root, 'master'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'node_modules/vitest'), { recursive: true });
    symlinkSync(resolve('scripts/puzzle-performance.mjs'), join(root, 'scripts/puzzle-performance.mjs'));
    writeFileSync(join(root, 'node_modules/vitest/vitest.mjs'), `
      import { readFileSync, writeFileSync, existsSync } from 'node:fs';
      const countFile = 'count';
      const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) + 1 : 1;
      writeFileSync(countFile, String(count));
      if (process.env.SCENARIO === 'solver-error') process.exit(3);
      const master = process.argv[process.argv.indexOf('--root') + 1].endsWith('/master');
      const scenario = process.env.SCENARIO;
      const pattern = new RegExp(process.argv[process.argv.indexOf('--testNamePattern') + 1]);
      const names = ['Classic AI solves puzzle example', 'Classic AI solves generated puzzle retry.two+[1]', 'Classic AI solves puzzle retry-three'];
      const history = existsSync('history') ? JSON.parse(readFileSync('history', 'utf8')) : [];
      const assertionResults = names.map((fullName, index) => {
        if (!pattern.test(fullName)) return { fullName, status: 'skipped' };
        history.push({ fullName, master });
        const attempt = Math.ceil(history.filter(r => r.fullName === fullName).length / 6);
        const fails = scenario === 'persistent' ? index === 1
          : scenario === 'transient' ? index === 1 && attempt === 1
          : scenario === 'third-attempt' ? index === 1 && attempt < 3
          : scenario === 'mixed' ? attempt <= index : false;
        return { fullName, status: 'passed', duration: master ? 10 : fails ? 20 : 5 };
      });
      writeFileSync('history', JSON.stringify(history));
      const report = { success: scenario !== 'invalid', testResults: [{ assertionResults }] };
      const output = process.argv.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
      writeFileSync(output, JSON.stringify(report));
    `);
    const result = spawnSync('bash', [resolve('scripts/check-puzzle-performance.sh'), join(root, 'master')], {
      cwd: root, env: { ...process.env, SCENARIO: scenario }, encoding: 'utf8',
    });
    return { status: result.status, output: result.stdout + result.stderr, runs: Number(readFileSync(join(root, 'count'), 'utf8')), history: result.status === 3 ? [] : JSON.parse(readFileSync(join(root, 'history'), 'utf8')) };
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

test('fails after a confirmed regression without retrying indefinitely', () => {
  const result = check('persistent');
  expect(result.status).toBe(1);
  expect(result.runs).toBe(18);
  expect(result.output).toContain('confirmed');
});

test('invalid reports and solver errors fail without retrying', () => {
  expect(check('invalid')).toMatchObject({ status: 2, runs: 6 });
  expect(check('solver-error')).toMatchObject({ status: 3, runs: 1 });
});


test('accepts a puzzle that passes on its third comparison', () => {
  const result = check('third-attempt');
  expect(result.status).toBe(0);
  expect(result.runs).toBe(18);
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
