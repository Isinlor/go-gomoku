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
      const duration = master ? 10 : (scenario === 'persistent' || (scenario === 'transient' && count <= 6) ? 20 : 5);
      const report = { success: scenario !== 'invalid', testResults: [{ assertionResults: [
        { fullName: 'Classic AI solves puzzle example', status: 'passed', duration }
      ] }] };
      const output = process.argv.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
      writeFileSync(output, JSON.stringify(report));
    `);
    const result = spawnSync('bash', [resolve('scripts/check-puzzle-performance.sh'), join(root, 'master')], {
      cwd: root, env: { ...process.env, SCENARIO: scenario }, encoding: 'utf8',
    });
    return { status: result.status, output: result.stdout + result.stderr, runs: Number(readFileSync(join(root, 'count'), 'utf8')) };
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
  expect(result.runs).toBe(12);
  expect(result.output).toContain('confirmed');
});

test('invalid reports and solver errors fail without retrying', () => {
  expect(check('invalid')).toMatchObject({ status: 2, runs: 6 });
  expect(check('solver-error')).toMatchObject({ status: 3, runs: 1 });
});
