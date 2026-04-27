import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

interface CLIOptions {
  candidate: string;
  baseline: string;
  boardSize: number;
  timeMs: number;
  minLowerBound: number;
  requireImprovement: boolean;
}

function parseArgs(argv: string[]): CLIOptions {
  const out: CLIOptions = {
    candidate: 'HEAD',
    baseline: 'master',
    boardSize: 9,
    timeMs: 30,
    minLowerBound: 0.5,
    requireImprovement: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--candidate' && value) {
      out.candidate = value;
      i += 1;
    } else if (key === '--baseline' && value) {
      out.baseline = value;
      i += 1;
    } else if (key === '--board-size' && value) {
      out.boardSize = Number.parseInt(value, 10);
      i += 1;
    } else if (key === '--time-ms' && value) {
      out.timeMs = Number.parseInt(value, 10);
      i += 1;
    } else if (key === '--min-lower-bound' && value) {
      out.minLowerBound = Number.parseFloat(value);
      i += 1;
    } else if (key === '--allow-regression') {
      out.requireImprovement = false;
    }
  }

  return out;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function withWorktree(repoRoot: string, ref: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gomoku-ref-'));
  try {
    runGit(['worktree', 'add', '--detach', tempDir, ref], repoRoot);
    await fn(tempDir);
  } finally {
    try {
      runGit(['worktree', 'remove', '--force', tempDir], repoRoot);
    } catch {
      // best effort cleanup
    }
  }
}

async function withRefDir(repoRoot: string, ref: string, fn: (dir: string) => Promise<void>): Promise<void> {
  if (ref === 'HEAD') {
    await fn(repoRoot);
    return;
  }
  await withWorktree(repoRoot, ref, fn);
}

async function importEngine(rootDir: string) {
  const moduleUrl = pathToFileURL(path.join(rootDir, 'src/engine/index.ts')).href;
  return import(moduleUrl);
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const strengthMod = await import(pathToFileURL(path.join(repoRoot, 'src/strength.ts')).href);

  await withRefDir(repoRoot, options.candidate, async (candidateDir) => {
    await withRefDir(repoRoot, options.baseline, async (baselineDir) => {
      const candidateEngine = await importEngine(candidateDir);
      const baselineEngine = await importEngine(baselineDir);

      const candidateFactory = () => new candidateEngine.GogoAI({ maxDepth: 6, quiescenceDepth: 4, maxPly: 64 });
      const baselineFactory = () => new baselineEngine.GogoAI({ maxDepth: 6, quiescenceDepth: 4, maxPly: 64 });

      const openings = strengthMod.defaultOpenings(options.boardSize);
      const summary = strengthMod.evaluateStrength(candidateFactory, baselineFactory, {
        boardSize: options.boardSize,
        timeLimitMs: options.timeMs,
        openings,
        now: () => 0,
      });

      const gate = strengthMod.gateImprovement(summary, options.minLowerBound);
      console.log(`Candidate ref: ${options.candidate}`);
      console.log(`Baseline ref: ${options.baseline}`);
      console.log(strengthMod.formatStrength(summary));
      console.log(`Gate: ${gate.passed ? 'PASS' : 'FAIL'} - ${gate.reason}`);

      if (options.requireImprovement && !gate.passed) {
        process.exit(1);
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
