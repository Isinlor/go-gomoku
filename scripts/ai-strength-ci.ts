import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {
    baseline: 'master',
    boardSize: 9,
    timeMs: 30,
    minLowerBound: 0.5,
    requireImprovement: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--baseline' && v) {
      out.baseline = v;
      i += 1;
    } else if (k === '--board-size' && v) {
      out.boardSize = Number.parseInt(v, 10);
      i += 1;
    } else if (k === '--time-ms' && v) {
      out.timeMs = Number.parseInt(v, 10);
      i += 1;
    } else if (k === '--min-lower-bound' && v) {
      out.minLowerBound = Number.parseFloat(v);
      i += 1;
    } else if (k === '--allow-regression') {
      out.requireImprovement = false;
    }
  }
  return out;
}

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function withWorktree(repoRoot, ref, fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gomoku-baseline-'));
  try {
    runGit(['worktree', 'add', '--detach', tempDir, ref], repoRoot);
    return await fn(tempDir);
  } finally {
    try {
      runGit(['worktree', 'remove', '--force', tempDir], repoRoot);
    } catch {
      // best effort cleanup
    }
  }
}

async function importEngine(rootDir) {
  const moduleUrl = pathToFileURL(path.join(rootDir, 'src/engine/index.ts')).href;
  const mod = await import(moduleUrl);
  return mod;
}

async function main() {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const strengthMod = await import(pathToFileURL(path.join(repoRoot, 'src/strength.ts')).href);
  const currentEngine = await importEngine(repoRoot);

  await withWorktree(repoRoot, options.baseline, async (baselineDir) => {
    const baselineEngine = await importEngine(baselineDir);

    const candidateFactory = () => new currentEngine.GogoAI({ maxDepth: 6, quiescenceDepth: 4, maxPly: 64 });
    const baselineFactory = () => new baselineEngine.GogoAI({ maxDepth: 6, quiescenceDepth: 4, maxPly: 64 });

    const openings = strengthMod.defaultOpenings(options.boardSize);
    const summary = strengthMod.evaluateStrength(candidateFactory, baselineFactory, {
      boardSize: options.boardSize,
      timeLimitMs: options.timeMs,
      openings,
      now: () => 0,
    });

    const gate = strengthMod.gateImprovement(summary, options.minLowerBound);

    console.log(`Baseline ref: ${options.baseline}`);
    console.log(strengthMod.formatStrength(summary));
    console.log(`Gate: ${gate.passed ? 'PASS' : 'FAIL'} - ${gate.reason}`);

    if (options.requireImprovement && !gate.passed) {
      process.exit(1);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
